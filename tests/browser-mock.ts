// Minimal Obsidian DOM host used only by the browser UI smoke test.
function create(parent: HTMLElement, tag: string, options: {text?: string; cls?: string; attr?: Record<string,string>} = {}) {
  const el = document.createElement(tag); if(options.text) el.textContent=options.text;
  if(options.cls) el.className=options.cls;
  for(const [key,value] of Object.entries(options.attr ?? {})) el.setAttribute(key,value);
  parent.appendChild(el); return el;
}
Object.assign(HTMLElement.prototype, {
  empty(this:HTMLElement) { this.replaceChildren(); },
  addClass(this:HTMLElement,...names:string[]) { this.classList.add(...names); },
  setText(this:HTMLElement,text:string) { this.textContent=text; },
  createEl(this:HTMLElement,tag:string,options:object={}) { return create(this,tag,options); },
  createDiv(this:HTMLElement,options:object={}) { return create(this,'div',options); },
  createSpan(this:HTMLElement,options:object={}) { return create(this,'span',options); }
});
export class App {}
export class Plugin {}
export class Modal {
  modalEl=create(document.body,'div',{cls:'modal'}); contentEl=create(this.modalEl,'div');
  constructor(public app:App) {}
  setTitle(title:string) { const el=create(this.modalEl,'div',{text:title,cls:'modal-title'});this.modalEl.prepend(el); }
  onOpen() {} onClose() {}
  open() { this.onOpen(); } close() {this.onClose();this.modalEl.remove();}
}
export class PluginSettingTab { constructor(public app:App, public plugin:Plugin) {} update() {} }
export class FuzzySuggestModal<T> extends Modal { setPlaceholder(_text:string) {} }
export class TFile {}
export class Notice { constructor(text:string) {document.body.setAttribute('data-notice',text);} }
export const requireApiVersion=()=>true;
export function setIcon(el:HTMLElement,name:string) {
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');
  const p=document.createElementNS(svg.namespaceURI,'path');
  p.setAttribute('d',name==='cloud'?'M6 18a4 4 0 0 1-1-7.9 7 7 0 0 1 13.7-1.5A4.8 4.8 0 0 1 18 18Z':'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6ZM8 12l3 3 5-6');svg.appendChild(p);el.replaceChildren(svg);
}
class Input {
  constructor(public inputEl:HTMLInputElement) {}
  setValue(v:string) {this.inputEl.value=v;return this;}
  setPlaceholder(v:string) {this.inputEl.placeholder=v;return this;}
  onChange(fn:(v:string)=>void) {this.inputEl.addEventListener('input',()=>fn(this.inputEl.value));return this;}
}
class Button {
  constructor(public buttonEl:HTMLButtonElement) {buttonEl.type='button';}
  setButtonText(v:string) {this.buttonEl.textContent=v;return this;}
  setIcon(v:string) {this.buttonEl.textContent=v==='eye'?'◉':'○';return this;}
  setTooltip(v:string) {this.buttonEl.title=v;return this;}
  setCta() {this.buttonEl.classList.add('mod-cta');return this;}
  onClick(fn:()=>void) {this.buttonEl.addEventListener('click',fn);return this;}
}
class Dropdown {
  constructor(public selectEl:HTMLSelectElement) {}
  addOption(value:string,text:string) {const o=document.createElement('option');o.value=value;o.textContent=text;this.selectEl.appendChild(o);return this;}
  addOptions(options:Record<string,string>) {for(const [v,t] of Object.entries(options))this.addOption(v,t);return this;}
  setValue(v:string) {this.selectEl.value=v;return this;}
  onChange(fn:(v:string)=>void) {this.selectEl.addEventListener('change',()=>fn(this.selectEl.value));return this;}
}
export class Setting {
  settingEl:HTMLElement; infoEl:HTMLElement; controlEl:HTMLElement;
  constructor(parent:HTMLElement) {this.settingEl=create(parent,'div',{cls:'setting-item'});this.infoEl=create(this.settingEl,'div',{cls:'setting-item-info'});this.controlEl=create(this.settingEl,'div',{cls:'setting-item-control'});}
  setName(v:string) {create(this.infoEl,'div',{text:v,cls:'setting-item-name'});return this;}
  setDesc(v:string) {create(this.infoEl,'div',{text:v,cls:'setting-item-description'});return this;}
  addText(fn:(i:Input)=>void) {const input=create(this.controlEl,'input') as HTMLInputElement;input.type='text';fn(new Input(input));return this;}
  addButton(fn:(i:Button)=>void) {fn(new Button(create(this.controlEl,'button') as HTMLButtonElement));return this;}
  addExtraButton(fn:(i:Button)=>void) {return this.addButton(fn);}
  addDropdown(fn:(i:Dropdown)=>void) {fn(new Dropdown(create(this.controlEl,'select') as HTMLSelectElement));return this;}
  addToggle(fn:(i:{setValue:(v:boolean)=>unknown;onChange:(f:(v:boolean)=>void)=>unknown})=>void) {
    const input=create(this.controlEl,'input') as HTMLInputElement;input.type='checkbox';
    const component={setValue(v:boolean){input.checked=v;return component;},onChange(f:(v:boolean)=>void){input.addEventListener('change',()=>f(input.checked));return component;}};fn(component);return this;
  }
}
