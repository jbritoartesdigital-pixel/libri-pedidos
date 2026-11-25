import {modal,modalRoot} from './admin-v2-core.js';
// Both order generations use exactly the same drawer shell, independent of title or code.
export function openOrderDrawer(title,html){
 const close=modal(title,html,{width:'920px'});
 modalRoot.classList.add('order-drawer-root');
 modalRoot.querySelector('.modal')?.classList.add('libri-order-drawer');
 return close;
}
