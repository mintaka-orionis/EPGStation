import * as m from 'mithril';
import Component from './Component';
import factory from '../ViewModel/ViewModelFactory';
import TabViewModel from '../ViewModel/Tab/TabViewModel';
import Util from '../Util/Util';
import Scroll from '../Util/Scroll';

interface TabArgs {
    tabs: string[];
    contentId: string;
}

/**
* tabComponent
*/
class TabComponent extends Component<TabArgs> {
    private viewModel: TabViewModel;

    constructor() {
        super();
        this.viewModel = <TabViewModel>(factory.get('TabViewModel'));
    }

    protected initViewModel(): void {
        super.initViewModel();
        this.viewModel.init();
    }

    /**
    * view
    */
    public view(vnode: m.Vnode<TabArgs, this>): m.Child {
        return m('div', { class: 'mdl-tabs mdl-js-tabs mdl-js-ripple-effect' }, [
            m('div', { class: 'tabs-bar' }, [
                vnode.attrs.tabs.map((tab, i) => {
                    return m('div', {
                        class: (i === 0 ? 'tab is-active' : 'tab'),
                        onclick: (e: Event) => { this.tabClick(e, i, vnode.attrs.contentId); },
                    }, tab);
                }),
            ]),
        ]);
    }

    /**
    * tab click
    * @param e: Event
    * @param index: tab position
    */
    private tabClick(e: Event, index: number, contentId: string): void {
        let isChangeTab = false;

        let tabs = document.getElementsByClassName('tabs-bar')[0].children;
        for(let i = 0; i < tabs.length; i++) {
            if(!tabs[i].classList.contains('is-active')) { continue; }
            if(i !== index) {
                isChangeTab = true;
                tabs[i].classList.remove('is-active');
            }
        }

        if(isChangeTab) {
            (<HTMLElement>e.target).classList.add('is-active');
            this.viewModel.set(index);
        }

        let content = <HTMLElement>(document.getElementById(contentId));
        if(content.scrollTop === 0) { return; }

        // scroll 処理
        let overflowY = content.style.overflowY;
        // mobile ではスクロールを一旦止める
        if(Util.uaIsMobile()) { content.style.overflowY = 'hidden'; }

        if(isChangeTab) { content.scrollTop = 0; }
        setTimeout(() => {
            content.style.overflowY = overflowY;
            if(!isChangeTab) {
                Scroll.scrollTo(content, content.scrollTop, 0, 300);
            }
        }, 100);
    }
}

export default TabComponent;
