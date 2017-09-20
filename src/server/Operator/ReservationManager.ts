import * as path from 'path';
import * as fs from 'fs';
import Base from '../Base';
import *  as apid from '../../../node_modules/mirakurun/api';
import { SearchInterface, OptionInterface, EncodeInterface } from './RuleInterface';
import { ProgramsDBInterface } from '../Model/DB/ProgramsDB';
import { RulesDBInterface } from '../Model/DB/RulesDB';
import * as DBSchema from '../Model/DB/DBSchema';
import { ReserveProgram } from './ReserveProgramInterface';
import DateUtil from '../Util/DateUtil';
import CheckRule from '../Util/CheckRule';

interface TunerThread {
    types: string;
    programs: ReserveProgram[]
}

interface TunerThreadsResult {
    conflicts: ReserveProgram[];
    skips: ReserveProgram[];
    tunerThreads: TunerThread[];
}

interface ReserveAllId {
    reserves: ReserveAllItem[],
    conflicts: ReserveAllItem[],
    skips: ReserveAllItem[],
}

interface ReserveAllItem {
    programId: number,
    ruleId?: number,
}

interface ReserveLimit {
    reserves: ReserveProgram[];
    total: number;
}

interface ReservationManagerInterface {
    setTuners(tuners: apid.TunerDevice[]): void;
    getReserve(programId: apid.ProgramId): ReserveProgram | null;
    getReservesAll(limit?: number, offset?: number): ReserveProgram[];
    getReservesAllId(): ReserveAllId;
    getReserves(limit?: number, offset?: number): ReserveLimit;
    getConflicts(limit?: number, offset?: number): ReserveLimit;
    getSkips(limit?: number, offset?: number): ReserveLimit;
    cancel(id: apid.ProgramId): void;
    removeSkip(id: apid.ProgramId): Promise<void>;
    addReserve(programId: apid.ProgramId, encode?: EncodeInterface): Promise<void>;
    updateRule(ruleId: number): Promise<void>;
    updateManual(manualId: number): Promise<void>;
    updateAll(): Promise<void>;
    clean(): void;
}

/**
* ReservationManager
* 予約の管理を行う
* @throws ReservationManagerCreateError init を呼ばないと起こる
*/
class ReservationManager extends Base {
    private static instance: ReservationManager;
    private static inited: boolean = false;
    private isRuleRunning: { [key: number]: boolean } = {};
    private isManualRunning: { [key: number]: boolean } = {};
    private isUpdateAllRunning: boolean = false;
    private programDB: ProgramsDBInterface;
    private rulesDB: RulesDBInterface;
    private reserves: ReserveProgram[] = []; //予約
    private tuners: apid.TunerDevice[] = [];
    private reservesPath: string;

    public static init(programDB: ProgramsDBInterface, rulesDB: RulesDBInterface) {
        if(ReservationManager.inited) { return; }
        ReservationManager.inited = true;
        this.instance = new ReservationManager(programDB, rulesDB);
        ReservationManager.inited = true;
    }

    public static getInstance(): ReservationManager {
        if(!ReservationManager.inited) {
            throw new Error('ReservationManagerCreateError');
        }

        return this.instance;
    }

    private constructor(programDB: ProgramsDBInterface, rulesDB: RulesDBInterface) {
        super();
        this.programDB = programDB;
        this.rulesDB = rulesDB;
        this.reservesPath = this.config.getConfig().reserves || path.join(__dirname, '..', '..', '..', 'data', 'reserves.json');
        this.readReservesFile();
    }

    /**
    * チューナ情報をセット
    * @param tuners: TunerDevice[]
    */
    public setTuners(tuners: apid.TunerDevice[]): void {
        this.tuners = tuners;
    }

    /**
    * 指定した id の予約状態を取得する
    * @param programId: program id
    * @return ReserveProgram | null
    */
    public getReserve(programId: apid.ProgramId): ReserveProgram | null {
        for(let reserve of this.reserves) {
            if(reserve.program.id === programId) {
                return reserve;
            }
        }

        return null;
    }

    /**
    * すべての予約状態を取得する
    * @return ReserveProgram[]
    */
    public getReservesAll(limit?: number, offset: number = 0): ReserveProgram[] {
        if(typeof limit !== 'undefined') {
            return this.reserves.slice(offset, limit + offset);
        }
        return this.reserves;
    }

    /**
    * 予約の program id だけを取得する
    * @return ReserveAllId
    */
    public getReservesAllId(): ReserveAllId {
        let reserves: ReserveAllItem[] = [];
        let conflicts: ReserveAllItem[] = [];
        let skips: ReserveAllItem[] = [];

        this.reserves.forEach((reserve) => {
            let result: ReserveAllItem = {
                programId: reserve.program.id,
            }
            if(typeof reserve.ruleId !== 'undefined') {
                result.ruleId = reserve.ruleId;
            }

            if(reserve.isConflict) {
                conflicts.push(result);
            } else if(reserve.isSkip) {
                skips.push(result);
            } else {
                reserves.push(result);
            }
        });

        return {
            reserves: reserves,
            conflicts: conflicts,
            skips: skips,
        }
    }

    /**
    * 予約状態を取得する
    * @return ReserveProgram[]
    */
    public getReserves(limit?: number, offset: number = 0): ReserveLimit {
        let reserves = this.reserves.filter((reserve) => {
            return !reserve.isConflict && !reserve.isSkip;
        });

        return {
            reserves: typeof limit === 'undefined' ? reserves : reserves.slice(offset, limit + offset),
            total: reserves.length,
        };
    }

    /**
    * コンフリクト状態を取得する
    * @return ReserveProgram[]
    */
    public getConflicts(limit?: number, offset: number = 0): ReserveLimit {
        let reserves = this.reserves.filter((reserve) => {
            return reserve.isConflict;
        });

        return {
            reserves: typeof limit === 'undefined' ? reserves : reserves.slice(offset, limit + offset),
            total: reserves.length,
        };
    }

    /**
    * スキップを取得する
    * @return ReserveProgram[]
    */
    public getSkips(limit?: number, offset: number = 0): ReserveLimit {
        let reserves = this.reserves.filter((reserve) => {
            return reserve.isSkip;
        });

        return {
            reserves: typeof limit === 'undefined' ? reserves : reserves.slice(offset, limit + offset),
            total: reserves.length,
        };
    }

    /**
    * 予約削除(手動予約) or 予約スキップ(ルール予約)
    * @param id: program id
    */
    public cancel(id: apid.ProgramId): void {
        for(let i = 0; i < this.reserves.length; i++) {
            if(this.reserves[i].program.id === id) {
                if(this.reserves[i].isManual) {
                    //手動予約なら削除
                    this.reserves.splice(i, 1);
                    this.writeReservesFile();
                    this.log.system.info(`cancel reserve: ${ id }`);
                    return;
                } else {
                    //ルール予約ならスキップを有効化
                    this.reserves[i].isSkip = true;
                    // skip すれば録画されないのでコンフリクトはしない
                    this.reserves[i].isConflict = false;
                    this.writeReservesFile();
                    this.log.system.info(`add skip: ${ id }`);
                    return;
                }
            }
        }
    }

    /**
    * 予約対象から除外され状態を解除する
    * @param id: number program id
    */
    public async removeSkip(id: apid.ProgramId): Promise<void> {
        for(let i = 0; i < this.reserves.length; i++) {
            if(this.reserves[i].program.id === id) {
                this.reserves[i].isSkip = false;
                this.log.system.info(`remove skip: ${ id }`);

                if(typeof this.reserves[i].ruleId !== 'undefined') {
                    await this.updateRule(this.reserves[i].ruleId!);
                }
            }
        }
    }

    /**
    * 手動予約追加
    * @param programId: number program id
    * @return Promise<void>
    * @throws ReservationManagerAddFailed 予約に失敗
    */
    public async addReserve(programId: apid.ProgramId, encode: EncodeInterface | null = null): Promise<void> {
        //reserves をコピー & programId の予約がすでに存在しないかを確認
        let tmpReserves: ReserveProgram[] = this.reserves.filter((reserve) => {
            if(reserve.program.id == programId) {
                this.log.system.error(`programId is reserves: ${ programId }`);
                throw new Error('ReservationManagerAddFailed');
            }
            return true;
        });

        // encode option がただしいかチェック
        if(encode != null && !(new CheckRule().checkEncodeOption(encode))) {
            throw new Error('ReservationManagerAddFailed');
        }

        let manualId = new Date().getTime();
        if(Boolean(this.isManualRunning[manualId])) { throw new Error(ReservationManager.isManualRunningError); }

        // 更新ロック
        this.isManualRunning[manualId] = true;
        this.log.system.info(`UpdateManualId: ${ manualId }`);

        let finalize = () => { this.isManualRunning[manualId] = false; }

        //番組情報を取得
        let programs: DBSchema.ProgramSchema[];
        try {
            programs = await this.programDB.findId(programId, true);
        } catch(err) {
            finalize();
            throw err;
        }

        // programId に該当する録画データがなかった
        if(programs.length === 0) {
            finalize();
            this.log.system.error(`program is not found: ${ programId }`);
            throw new Error('ProgramIsNotFound');
        }

        //番組情報を記録
        let reserve: ReserveProgram = {
            program: programs[0],
            isSkip: false,
            isManual: true,
            manualId: manualId,
            isConflict: false,
        };
        if(encode != null) {
            reserve.encodeOption = encode;
        }
        let matches: ReserveProgram[] = [ reserve ];

        // tmpReserves に matches の番組情報を追加する
        let results = this.pushTunerThreads(tmpReserves);
        results = this.pushTunerThreads(
            matches,
            false,
            results.conflicts,
            results.skips,
            results.tunerThreads
        );

        results.conflicts.forEach((conflict) => {
            if(conflict.program.id === programId) {
                finalize();
                this.log.system.error(`program id conflict: ${ programId }`);
                throw new Error('ReservationManagerAddReserveConflict');
            }
        });

        this.saveReserves(results);
        finalize();
    }

    /**
    * rule 更新
    * @param ruleId: number
    * @return Promise<void>
    */
    public async updateRule(ruleId: number): Promise<void> {
        // 実行中ならエラー
        if(Boolean(this.isRuleRunning[ruleId])) { throw new Error(ReservationManager.isRuleRunningError); }

        // ロック
        this.isRuleRunning[ruleId] = true;
        this.log.system.info(`UpdateRuleId: ${ ruleId }`);

        let finalize = () => { this.isRuleRunning[ruleId] = false; }

        // rule を取得
        let rule: DBSchema.RulesSchema;
        try {
            let result = await this.rulesDB.findId(ruleId);
            if(result.length !== 0) {
                rule = result[0];
            }

            // rule が存在しなかった
            if(result.length === 0 || !rule!.enable) {
                let now = new Date().getTime();
                let tmpReserves: ReserveProgram[] = this.reserves.filter((reserve) => {
                    // ruleId が一致して録画中でなければ削除する
                    return !(!reserve.isManual && reserve.ruleId === ruleId && !(reserve.program.startAt <= now && reserve.program.endAt <= now));
                });
                this.reserves = tmpReserves;
                this.writeReservesFile();
                finalize();
                return;
            }
        } catch(err) {
            finalize();
            throw err;
        }

        // スキップ情報を記憶
        let skipIndex: { [key: number]: boolean } = {};
        // ruleId の予約を削除した予約情報を作成
        let tmpReserves: ReserveProgram[] = this.reserves.filter((reserve) => {
            if(reserve.isSkip) { skipIndex[reserve.program.id] = reserve.isSkip; }
            return !(!reserve.isManual && reserve.ruleId === ruleId);
        });

        // 番組情報を取得
        let programs: DBSchema.ProgramSchema[];
        try {
            programs = await this.programDB.findRule(this.createSearchOption(rule!));
        } catch(err) {
            finalize();
            throw err;
        }

        //番組情報を保存
        let matches: ReserveProgram[] = [];
        programs.forEach((program) => {
            let data: ReserveProgram = {
                program: program,
                ruleId: ruleId,
                ruleOption: this.createOption(rule),
                isSkip: typeof skipIndex[program.id] === 'undefined' ? false : skipIndex[program.id],
                isManual: false,
                isConflict: false,
            };
            let encode = this.createEncodeOption(rule);
            if(encode !== null) {
                data.encodeOption = encode;
            }
            matches.push(data);
        });

        // tmpReserves に matches の番組情報を追加する
        let results = this.pushTunerThreads(tmpReserves);
        results = this.pushTunerThreads(
            matches,
            true,
            results.conflicts,
            results.skips,
            results.tunerThreads
        );

        // log にコンフリクトを書き込む
        results.conflicts.forEach((conflict) => {
            if(typeof conflict.ruleId !== 'undefined' && conflict.ruleId === ruleId) {
                this.writeConflictLog(conflict);
            }
        });

        this.saveReserves(results);
        finalize();
    }

    /**
    * 手動予約アップデート
    * @param manualId: manualId
    * @return Promise<void>
    */
    public async updateManual(manualId: number): Promise<void> {
        if(Boolean(this.isManualRunning[manualId])) { throw new Error(ReservationManager.isManualRunningError); }

        // 更新ロック
        this.isManualRunning[manualId] = true;
        this.log.system.info(`UpdateManualId: ${ manualId }`);

        let finalize = () => { this.isManualRunning[manualId] = false; }

        // reserves の中から manualId の予約情報をコピーする
        let manualMatche: ReserveProgram | null = null;
        // manualId に該当する予約を削除した予約情報を作成
        let tmpReserves: ReserveProgram[] = this.reserves.filter((reserve) => {
            if(reserve.manualId !== manualId) { return true; }

            manualMatche = reserve;
            return false;
        });

        // manualId に一致する予約情報がなかった
        if(manualMatche === null) {
            finalize();
            this.log.system.error(`updateManual error: ${ manualId }`);
            throw new Error('ReservationManagerIsNotFoundManualReserve');
        }

        //番組情報を取得
        let programs: DBSchema.ProgramSchema[];
        try {
            programs = await this.programDB.findId(manualMatche!.program.id, true);
        } catch(err) {
            finalize();
            throw err;
        }

        // 該当する番組情報がなかった
        if(programs.length === 0) {
            this.reserves = tmpReserves;
            this.writeReservesFile();
            finalize();
            return;
        }

        //番組情報を保存
        manualMatche!.program = programs[0];
        let matches: ReserveProgram[] = [ manualMatche ];

        // tmpReserves に matches の番組情報を追加する
        let results = this.pushTunerThreads(tmpReserves);
        results = this.pushTunerThreads(
            matches,
            true,
            results.conflicts,
            results.skips,
            results.tunerThreads
        );

        // log にコンフリクトを書き込む
        results.conflicts.forEach((conflict) => {
            if(typeof conflict.manualId !== 'undefined' && conflict.manualId === manualId) {
                this.writeConflictLog(conflict);
            }
        });

        this.saveReserves(results);
        finalize();
    }


    /**
    * RulesSchema から searchInterface を生成する
    * @param rule: DBSchema.RulesSchema
    * @return SearchInterface
    */
    private createSearchOption(rule: DBSchema.RulesSchema): SearchInterface {
        let search: SearchInterface = {
            week: rule.week
        }

        if(rule.keyword !== null)       { search.keyword       = rule.keyword       }
        if(rule.ignoreKeyword !== null) { search.ignoreKeyword = rule.ignoreKeyword }
        if(rule.keyCS !== null)         { search.keyCS         = rule.keyCS         }
        if(rule.keyRegExp !== null)     { search.keyRegExp     = rule.keyRegExp     }
        if(rule.title !== null)         { search.title         = rule.title         }
        if(rule.description !== null)   { search.description   = rule.description   }
        if(rule.extended !== null)      { search.extended      = rule.extended      }
        if(rule.GR !== null)            { search.GR            = rule.GR            }
        if(rule.BS !== null)            { search.BS            = rule.BS            }
        if(rule.CS !== null)            { search.CS            = rule.CS            }
        if(rule.SKY !== null)           { search.SKY           = rule.SKY           }
        if(rule.station !== null)       { search.station       = rule.station       }
        if(rule.genrelv1 !== null)      { search.genrelv1      = rule.genrelv1      }
        if(rule.genrelv2 !== null)      { search.genrelv2      = rule.genrelv2      }
        if(rule.startTime !== null)     { search.startTime     = rule.startTime     }
        if(rule.timeRange !== null)     { search.timeRange     = rule.timeRange     }
        if(rule.isFree !== null)        { search.isFree        = rule.isFree        }
        if(rule.durationMin !== null)   { search.durationMin   = rule.durationMin   }
        if(rule.durationMax !== null)   { search.durationMax   = rule.durationMax   }

        return search;
    }

    /**
    * RulesSchema から OptionInterface を生成する
    * @param rule: DBSchema.RulesSchema
    * @return OptionInterface
    */
    private createOption(rule: DBSchema.RulesSchema): OptionInterface {
        let option: OptionInterface = {
            enable: rule.enable
        };

        if(rule.directory !== null) { option.directory = rule.directory; }
        if(rule.recordedFormat !== null) { option.recordedFormat = rule.recordedFormat; }

        return option;
    }

    /**
    * RulesSchema から EncodeInterface を生成する
    * @param rule: DBSchema.RulesSchema
    * @return OptionInterface | null
    */
    public createEncodeOption(rule: DBSchema.RulesSchema): EncodeInterface | null {
        if(rule.delTs === null) { return null; }

        let encode: EncodeInterface = {
            delTs: rule.delTs
        }

        if(rule.mode1 !== null) { encode.mode1 = rule.mode1; }
        if(rule.directory1 !== null) { encode.directory1 = rule.directory1; }
        if(rule.mode2 !== null) { encode.mode2 = rule.mode2; }
        if(rule.directory2 !== null) { encode.directory2 = rule.directory2; }
        if(rule.mode3 !== null) { encode.mode3 = rule.mode3; }
        if(rule.directory3 !== null) { encode.directory3 = rule.directory3; }

        return encode;
    }

    /**
    * tunerThreads に matches を格納する
    * @param matches: 格納するデータ
    * @param check: 重複を詳しくチェック
    * @param conflicts: conflicts
    * @param skips スキップ
    * @param tunerThreads: tunerThreads
    * @return TunerThreadsResult
    */
    private pushTunerThreads(
        matches: ReserveProgram[],
        check: boolean = true,
        conflicts: ReserveProgram[] = [],
        skips: ReserveProgram[] = [],
        tunerThreads: TunerThread[] = []
    ): TunerThreadsResult {
        if(tunerThreads.length == 0) {
            this.tuners.forEach((tuner) => { tunerThreads.push({ types: tuner.types, programs: [] }); });
        }

        // それぞれの放送波ごとのチューナーの最終位置を記録
        let tunerMaxPosition = { GR: 0, BS: 0, CS: 0, SKY: 0 };
        tunerThreads.forEach((threads, i) => {
            if(threads.types.indexOf('GR') !== -1) { tunerMaxPosition.GR = i; }
            if(threads.types.indexOf('BS') !== -1) { tunerMaxPosition.BS = i; }
            if(threads.types.indexOf('CS') !== -1) { tunerMaxPosition.CS = i; }
            if(threads.types.indexOf('SKY') !== -1) { tunerMaxPosition.SKY = i; }
        });

        let now = new Date().getTime();

        //tunerThreads に matches の内容を格納する
        for(let i = 0; i < matches.length; i++) {
            if (matches[i].isSkip) {
                matches[i].isConflict = false;
                skips.push(matches[i]);
                continue;
            }

            matches[i].isConflict = true;

            //コンフリクトチェック
            for(let j = 0; j < tunerThreads.length; j++) {
                if(tunerThreads[j].types.indexOf(matches[i].program.channelType) !== -1) {
                    matches[i].isConflict = false;
                    for(let k = 0; k < tunerThreads[j].programs.length; k++) {
                        let t = tunerThreads[j].programs[k];
                        let m = matches[i];
                        if (!((t.program.endAt <= m.program.startAt) || (t.program.startAt >= m.program.endAt)) && !(t.program.channel == m.program.channel && t.program.serviceId != m.program.serviceId)) {
                            //チューナーがこれ以上余りがない場合
                            //手動予約同士のコンフリクト manualId の若い方を優先する
                            //手動予約を優先する
                            //ルール同士のコンフリクト ruleId が若い方を優先する
                            //録画中(延長された)
                            if(tunerThreads[matches[i].program.channelType] === k &&  check && (
                                (t.isManual && m.isManual && t.manualId! > m.manualId!)
                                || (!t.isManual && m.isManual)
                                || (!t.isManual && !m.isManual && t.ruleId! > m.ruleId!)
                                || (m.program.startAt <= now && m.program.endAt <= now)
                            )) {
                                tunerThreads[j].programs[k].isConflict = true;
                                conflicts.push(tunerThreads[j].programs[k]);
                                tunerThreads[j].programs.splice(k, 1);
                                break;
                            } else {
                                matches[i].isConflict = true;
                                break;
                            }
                        }
                    }

                    //コンフリクトしていなければ tunerThreads[j].programs へ追加
                    if(!matches[i].isConflict) {
                        tunerThreads[j].programs.push(matches[i]);
                        break;
                    }
                }
            }

            if(matches[i].isConflict) {
                conflicts.push(matches[i]);
            }
        }

        return {
            conflicts: conflicts,
            skips: skips,
            tunerThreads: tunerThreads
        };
    }

    /**
    * コンフリクトログを書き込む
    * @param conflict: ReserveProgram
    */
    private writeConflictLog(conflict: ReserveProgram): void {
        this.log.system.warn(`conflict: ${ conflict.program.id } ${ DateUtil.format(new Date(conflict.program.startAt), 'yyyy-MM-ddThh:mm:ss') } ${ conflict.program.name }`);
    }

    /**
    * TunerThreadsResult を reserves へ保存する
    * @param results: TunerThreadsResult
    */
    private saveReserves(results: TunerThreadsResult): void {
        let reserves: ReserveProgram[] = [];
        results.tunerThreads.forEach((thread) => {
            Array.prototype.push.apply(reserves, thread.programs);
        });
        Array.prototype.push.apply(reserves, results.skips);
        Array.prototype.push.apply(reserves, results.conflicts);

        //startAt でソート
        reserves.sort((a, b) => { return a.program.startAt - b.program.startAt });

        this.reserves = reserves;
        this.writeReservesFile();
    }

    /**
    * すべての予約状態を更新
    * @return Promise<void> すでに実行中なら ReservationManagerUpdateIsRunning が発行される
    */
    public async updateAll(): Promise<void> {
        if(this.isUpdateAllRunning) { return; }
        this.isUpdateAllRunning = true;

        this.log.system.info('updateAll start');

        let rules = await this.rulesDB.findAllId();

        // ruleIndex を作成
        let ruleIndex: { [key: number]: boolean } = {};
        rules.forEach((result) => { ruleIndex[result.id] = true; });

        //存在しない rule を削除
        let newReserves = this.reserves.filter((reserve) => {
            return !(typeof reserve.ruleId !== 'undefined' && typeof ruleIndex[reserve.ruleId] === 'undefined');
        });
        this.reserves = newReserves;
        this.writeReservesFile();

        // 手動予約の情報を追加する
        for(let reserve of this.reserves) {
            if(!reserve.isManual || typeof reserve.manualId === 'undefined') { continue; }
            await this.updateManual(reserve.manualId!);
        }

        for(let rule of rules) {
            await this.updateRule(rule.id);
        }

        this.isUpdateAllRunning = false;
        this.log.system.info('updateAll done');
    }

    /**
    * 終了時刻を過ぎている予約を削除する
    */
    public clean(): void {
        let now = new Date().getTime();
        this.reserves = this.reserves.filter((reserve) => {
            return !(now > reserve.program.endAt);
        });
    }

    /**
    * 予約をファイルから読み込む
    */
    private readReservesFile(): void {
        try {
            let reserves = fs.readFileSync(this.reservesPath, "utf-8");
            this.reserves = JSON.parse(reserves);
        } catch(e) {
            if(e.code == 'ENOENT') {
                this.log.system.warn('reserves.json is not found.');
                this.reserves = [];
            } else {
                this.log.system.fatal(e);
                this.log.system.fatal('reserves.json parse error');
                process.exit();
            }
        }
    }

    /**
    * 予約をファイルへ書き込む
    */
    private writeReservesFile(): void {
        fs.writeFileSync(
            this.reservesPath,
            JSON.stringify(this.reserves),
            { encoding: 'utf-8' }
        );
        //this.eventsNotify();
    }
}

namespace ReservationManager {
    export const isRuleRunningError = 'ReservationManagerUpdateRuleIsRunning';
    export const isManualRunningError = 'ReservationManagerUpdateManualIsRunning';
    export const ruleIsNotFoundError = 'ReservationManagerRuleIsNotFound';
}

export { ReserveAllId, ReserveLimit, ReservationManagerInterface, ReservationManager };
