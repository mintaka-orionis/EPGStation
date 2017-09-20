import { Operation } from 'express-openapi';
import * as api from '../../../api';
import factory from '../../../../Model/ModelFactory';
import { ReservesModelInterface } from '../../../../Model/Api/ReservesModel';

export const del: Operation = async (req, res) => {
    let reserves = <ReservesModelInterface>(factory.get('ReservesModel'));

    try {
        await reserves.removeReserveSkip(req.params.id);
        api.responseJSON(res, 200, { code: 200 });
        api.notifyClient();
    } catch(err) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: '予約除外状態を解除',
    tags: ['reserves'],
    description: '予約除外状態を解除する',
    parameters: [
        {
            name: 'id',
            in: 'path',
            description: 'program id',
            required: true,
            type: 'integer'
        }
    ],
    responses: {
        200: {
            description: '予約除外状態を解除しました'
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error'
            }
        }
    }
};
