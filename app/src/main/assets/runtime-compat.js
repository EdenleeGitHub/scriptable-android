/* Complete small Scriptable type aliases and configurable alert text fields. */
(() => {
  'use strict';
  const R = self.__runtime, { Data, Font, Color, Alert, FileManager } = self;
  const text = (value, label) => { if (typeof value !== 'string') throw new TypeError(`${label} must be a string.`); return value; };
  Data.fromFile = filePath => FileManager.local().read(text(filePath, 'File path'));
  Data.fromBytes = bytes => {
    if (!(Array.isArray(bytes) || bytes instanceof Uint8Array)) throw new TypeError('Bytes must be an array of integers.');
    if (bytes.length > 8 * 1024 * 1024) throw new Error('Data exceeds 8 MiB.');
    for (const byte of bytes) if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new RangeError('Bytes must be integers between 0 and 255.');
    return new Data(bytes);
  };
  self.console.logError = (...values) => self.console.error(...values);
  self.logError = (...values) => self.console.error(...values);
  const weights = { ultraLight: 100, thin: 200, light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 800, black: 900 };
  for (const [weightName, weight] of Object.entries(weights)) for (const [suffix, family] of [['MonospacedSystemFont', 'monospace'], ['RoundedSystemFont', 'sans-serif-rounded']]) {
    Font[weightName + suffix] = size => { const font = new Font(family, size); font.weight = String(weight); return font; };
  }
  self.URLScheme.parameter = name => { name = text(name, 'Parameter name'); const parameters = self.args.queryParameters || {}; return Object.prototype.hasOwnProperty.call(parameters, name) ? parameters[name] ?? null : null; };
  class TextField {
    constructor(placeholder = '', value = '', secure = false) {
      this._text = text(value, 'Text'); this._placeholder = text(placeholder, 'Placeholder'); this._secure = !!secure;
      this._font = null; this._textColor = null; this.keyboardType = 'default'; this.alignment = 'left';
    }
    get text() { return this._text; } set text(value) { this._text = text(value, 'Text'); }
    get value() { return this.text; } set value(value) { this.text = value; }
    get placeholder() { return this._placeholder; } set placeholder(value) { this._placeholder = text(value, 'Placeholder'); }
    get isSecure() { return this._secure; } set isSecure(value) { this._secure = !!value; }
    get secure() { return this.isSecure; } set secure(value) { this.isSecure = value; }
    get textColor() { return this._textColor; } set textColor(value) { if (value != null && !(value instanceof Color)) throw new TypeError('Text color must be a Color.'); this._textColor = value; }
    get font() { return this._font; } set font(value) { if (value != null && !(value instanceof Font)) throw new TypeError('Text field font must be a Font.'); this._font = value; }
    leftAlignText() { this.alignment = 'left'; }
    centerAlignText() { this.alignment = 'center'; }
    rightAlignText() { this.alignment = 'right'; }
    toJSON() { return { placeholder: this.placeholder, value: this.value, secure: this.secure, keyboardType: this.keyboardType, textColor: this.textColor, font: this.font, alignment: this.alignment }; }
  }
  for (const [method, type] of Object.entries({ Default: 'default', NumberPad: 'numberPad', DecimalPad: 'decimalPad', NumbersAndPunctuation: 'numbersAndPunctuation', PhonePad: 'phonePad', WebSearch: 'webSearch', EmailAddress: 'emailAddress', URL: 'url', Twitter: 'twitter' })) TextField.prototype['set' + method + 'Keyboard'] = function () { this.keyboardType = type; };
  Alert.prototype.addTextField = function (placeholder = '', value = '') { const field = new TextField(placeholder, value, false); this._fields.push(field); return field; };
  Alert.prototype.addSecureTextField = function (placeholder = '', value = '') { const field = new TextField(placeholder, value, true); this._fields.push(field); return field; };
  // UIKit's nullable/default properties are observable before a script sets them.
  const defaults=(prototype,values)=>{for(const [key,value]of Object.entries(values))if(!(key in prototype))Object.defineProperty(prototype,key,{configurable:true,get(){const result=typeof value==='function'?value():value;Object.defineProperty(this,key,{value:result,writable:true,configurable:true,enumerable:true});return result;},set(result){Object.defineProperty(this,key,{value:result,writable:true,configurable:true,enumerable:true});}});};
  defaults(self.WidgetText.prototype,{textColor:null,textOpacity:1,lineLimit:0,minimumScaleFactor:1,shadowColor:null,shadowRadius:0,shadowOffset:()=>new self.Point(0,0),url:null});
  defaults(self.WidgetImage.prototype,{resizable:true,imageSize:null,imageOpacity:1,cornerRadius:0,borderWidth:0,borderColor:null,containerRelativeShape:false,tintColor:null,url:null});
  defaults(self.WidgetStack.prototype,{backgroundColor:null,backgroundImage:null,backgroundGradient:null,size:()=>new self.Size(0,0),cornerRadius:0,borderWidth:0,borderColor:null,url:null});
  defaults(self.ListWidget.prototype,{refreshAfterDate:null,addAccessoryWidgetBackground:false});
  defaults(self.UITableCell.prototype,{titleColor:null,subtitleColor:null,titleFont:null,subtitleFont:null});
  defaults(self.UITableRow.prototype,{backgroundColor:null});
  defaults(self.Notification.prototype,{preferredContentHeight:null});
  defaults(self.Request.prototype,{onRedirect:null});
  defaults(self.XMLParser.prototype,{didStartDocument:null,didEndDocument:null,didStartElement:null,didEndElement:null,foundCharacters:null,parseErrorOccurred:null});
  for(const [name,get]of Object.entries({minX(){return Math.min(this.x,this.x+this.width);},maxX(){return Math.max(this.x,this.x+this.width);},minY(){return Math.min(this.y,this.y+this.height);},maxY(){return Math.max(this.y,this.y+this.height);}}))Object.defineProperty(self.Rect.prototype,name,{get,configurable:true});
  R.register({ TextField });
})();
