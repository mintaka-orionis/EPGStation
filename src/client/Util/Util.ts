import * as m from 'mithril';

/**
* Util モジュール
* よく使う処理をまとめたもの
*/
namespace Util {
    /**
    * Material Desgin Lite の DOM をアップグレードする
    */
    export const upgradeMdl = (): void => {
        componentHandler.upgradeDom();
        let el = document.getElementsByClassName( 'mdl-layout__container' );
        for(let i = 0; i < el.length - 1; i++) { el[i].parentNode!.removeChild(el[i]); }
    }

    /**
    * query のコピーを返す
    * @return query
    */
    export const getCopyQuery = (): { [key: string]: any } => {
        return JSON.parse(JSON.stringify(m.route.param()));
    }

    /**
    * クリックされた要素の座標を返す
    * @param event: Event
    * @return x: 画面上の x 座標
    *         y: 画面上の y 座標
    *         width: クリックされた要素の幅
    *         height: クリックされた要素の高さ
    */
    export const getClickPosition = (event: Event): { x: number, y: number, width: number, height: number } => {
        let elmX: number, elmY: number;

        if ((<TouchEvent>event).targetTouches) {
            // mobile
            elmX = (<TouchEvent>event).targetTouches[0].pageX - (<HTMLElement>event.target).offsetLeft;
            elmY = (<TouchEvent>event).targetTouches[0].pageY - (<HTMLElement>event.target).offsetTop;
        } else if ((document.all || 'all' in document) && !Util.uaIsFirefox()) {
            elmX = (<MouseEvent>event).offsetX;
            elmY = (<MouseEvent>event).offsetY;
        } else {
            elmX = (<MouseEvent>event).layerX;
            elmY = (<MouseEvent>event).layerY;
        }

        let rect = (<HTMLElement>event.target).getBoundingClientRect();
        let x = (<MouseEvent>event).x - elmX;
        if(x === 0) {
            // firefox で起こる
            x = rect.left;
        }

        let y = (<MouseEvent>event).y - elmY;
        if(y === 0) {
            // firefox で起こる
            y = rect.top
        }

        return {
            x: x,
            y: y,
            width: (<HTMLElement>event.target).offsetWidth,
            height: (<HTMLElement>event.target).offsetHeight,
        };
    }

    /**
    * UA が iOS か判定
    * @return boolean
    */
    export const uaIsiOS = (): boolean => {
        return /iPad|iPhone|iPod/.test(navigator.userAgent);
    }

    /**
    * UA が Android か判定
    * @return boolean
    */
    export const uaIsAndroid = (): boolean => {
        return /Android|android/.test(navigator.userAgent);
    }

    /**
    * UA が Edge か判定
    * @return boolean
    */
    export const uaIsEdge = (): boolean => {
        return /Edge|edge/.test(navigator.userAgent);
    }

    /**
    * UA が IE か判定
    * @return boolean
    */
    export const uaIsIE = (): boolean => {
        return /msie|MSIE/.test(navigator.userAgent) || /Trident/.test(navigator.userAgent);
    }

    /**
    * UA が Chrome か判定
    * @return boolean
    */
    export const uaIsChrome = (): boolean => {
        return /chrome|Chrome/.test(navigator.userAgent);
    }

    /**
    * UA が Firefox か判定
    * @return boolean
    */
    export const uaIsFirefox = (): boolean => {
        return /firefox|Firefox/.test(navigator.userAgent);
    }

    /**
    * UA が Mobile か判定
    * @return boolean
    */
    export const uaIsMobile = (): boolean => {
        return /Mobile|mobile/.test(navigator.userAgent);
    }

    /**
    * close Navigation
    */
    export const closeNavigation = (): void => {
        let navi = document.getElementsByClassName('mdl-layout__obfuscator');
        if(navi.length > 0) {
            (<HTMLElement>navi[0]).click();
        }
    }
}

export default Util;
