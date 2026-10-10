/* Original Android implementation of Scriptable drawing and utility APIs.
 * Rendering is synchronous in the Worker: getImage() returns encoded pixels,
 * never a recipe or a Promise. The bounded native endpoint is supplied by core.
 */
(() => {
  'use strict';
  const runtime = self.__runtime;
  const { Data, Image, Color, Font, Point, Size, Rect } = self;
  const number = (value, label = 'Value') => { const n = Number(value); if (!Number.isFinite(n) || Math.abs(n) > 1000000) throw new TypeError(`${label} must be a finite number within ±1000000.`); return n; };
  const point = value => ({ x: number(value?.x, 'x'), y: number(value?.y, 'y') });
  const rect = value => ({ ...point(value), width: number(value?.width, 'width'), height: number(value?.height, 'height') });
  const color = value => { if (!(value instanceof Color)) throw new TypeError('Expected Color.'); return '#' + value.hex + Math.round(value.alpha * 255).toString(16).padStart(2, '0'); };
  const font = value => { if (!(value instanceof Font)) throw new TypeError('Expected Font.'); if (!(value.size > 0 && value.size <= 1024)) throw new Error('Font size must be between 0 and 1024.'); return { family: value.family, size: value.size, weight: value.weight, style: value.style || 'normal' }; };
  const sync = (action, payload) => runtime.syncHost(action, payload);
  const imageFromReply = reply => { if (!reply?.base64) throw new Error('Renderer did not return image pixels.'); const image = new Image(Data.fromBase64String(reply.base64), reply.mimeType || 'image/png'); image._imageSize = new Size(reply.width, reply.height); return image; };
  Object.defineProperty(Image.prototype, 'size', { configurable: true, get() { if (!this._imageSize) { const reply = sync('image.info', { base64: this.data.toBase64String() }); this._imageSize = new Size(reply.width, reply.height); this.mimeType = reply.mimeType || this.mimeType; } return new Size(this._imageSize.width, this._imageSize.height); } });
  Image.fromData = function (data) { if (!(data instanceof Data)) throw new TypeError('Expected Data.'); const reply = sync('image.info', { base64: data.toBase64String() }); const image = new Image(data, reply.mimeType); image._imageSize = new Size(reply.width, reply.height); return image; };
  Data.fromPNG = image => { if (!(image instanceof Image)) throw new TypeError('Expected Image.'); return Data.fromBase64String(sync('image.convert', { base64: image.data.toBase64String(), format: 'png' }).base64); };
  Data.fromJPEG = (image, quality = 0.9) => { if (!(image instanceof Image)) throw new TypeError('Expected Image.'); quality = number(quality, 'JPEG quality'); if (quality < 0 || quality > 1) throw new Error('JPEG quality must be between 0 and 1.'); return Data.fromBase64String(sync('image.convert', { base64: image.data.toBase64String(), format: 'jpeg', quality }).base64); };
  for (const [name, getter] of Object.entries({ hue() { const max = Math.max(this.red, this.green, this.blue), min = Math.min(this.red, this.green, this.blue), delta = max - min; if (!delta) return 0; return ((max === this.red ? (this.green - this.blue) / delta : max === this.green ? (this.blue - this.red) / delta + 2 : (this.red - this.green) / delta + 4) / 6 + 1) % 1; }, saturation() { const max = Math.max(this.red, this.green, this.blue); return max ? (max - Math.min(this.red, this.green, this.blue)) / max : 0; }, brightness() { return Math.max(this.red, this.green, this.blue); } })) Object.defineProperty(Color.prototype, name, { configurable: true, get: getter });
  class LinearGradient {
    constructor() { this.colors = []; this.locations = []; this.startPoint = new Point(0, 0); this.endPoint = new Point(0, 1); }
    toJSON() { if (!Array.isArray(this.colors) || this.colors.some(c => !(c instanceof Color))) throw new TypeError('Gradient colors must be Colors.'); if (this.locations.length && (this.locations.length !== this.colors.length || this.locations.some((n, i) => !Number.isFinite(n) || n < 0 || n > 1 || (i && n < this.locations[i - 1])))) throw new Error('Gradient locations must be ordered between 0 and 1 and match the colors.'); return { colors: this.colors, locations: this.locations, startPoint: point(this.startPoint), endPoint: point(this.endPoint) }; }
  }
  class Path {
    constructor() { this._segments = []; }
    _add(op, values = {}) { if (this._segments.length >= 10000) throw new Error('Path has more than 10000 segments.'); this._segments.push({ op, ...values }); }
    move(p) { this._add('move', point(p)); }
    addLine(p) { this._add('line', point(p)); }
    addRect(r) { this._add('rect', rect(r)); }
    addEllipse(r) { this._add('ellipse', rect(r)); }
    addRoundedRect(r, cornerWidth, cornerHeight) { this._add('roundRect', { ...rect(r), rx: Math.max(0, number(cornerWidth)), ry: Math.max(0, number(cornerHeight)) }); }
    addCurve(p, control1, control2) { this._add('curve', { ...point(p), c1: point(control1), c2: point(control2) }); }
    addQuadCurve(p, control) { this._add('quad', { ...point(p), c: point(control) }); }
    addLines(points) { if (!Array.isArray(points)) throw new TypeError('Expected an array of Points.'); points.forEach((p, i) => i ? this.addLine(p) : this.move(p)); }
    addRects(rects) { if (!Array.isArray(rects)) throw new TypeError('Expected an array of Rects.'); rects.forEach(r => this.addRect(r)); }
    closeSubpath() { this._add('close'); }
  }
  class DrawContext {
    constructor() { this.size = new Size(0, 0); this.opaque = true; this.respectScreenScale = false; this._commands = []; this._path = []; this._fill = '#000000ff'; this._stroke = '#000000ff'; this._textColor = '#000000ff'; this._lineWidth = 1; this._font = font(Font.systemFont(12)); this._alignment = 'left'; }
    _add(op, values) { if (this._commands.length >= 10000) throw new Error('Drawing has more than 10000 operations.'); this._commands.push({ op, ...values }); }
    setFillColor(c) { this._fill = color(c); }
    setStrokeColor(c) { this._stroke = color(c); }
    setLineWidth(width) { this._lineWidth = number(width, 'Line width'); if (this._lineWidth < 0 || this._lineWidth > 1024) throw new Error('Line width must be between 0 and 1024.'); }
    fill(r) { this.fillRect(r); }
    stroke(r) { this.strokeRect(r); }
    fillRect(r) { this._add('fillRect', { rect: rect(r), color: this._fill }); }
    strokeRect(r) { this._add('strokeRect', { rect: rect(r), color: this._stroke, lineWidth: this._lineWidth }); }
    fillEllipse(r) { this._add('fillEllipse', { rect: rect(r), color: this._fill }); }
    strokeEllipse(r) { this._add('strokeEllipse', { rect: rect(r), color: this._stroke, lineWidth: this._lineWidth }); }
    addPath(path) { if (!(path instanceof Path)) throw new TypeError('Expected Path.'); this._path = JSON.parse(JSON.stringify(path._segments)); }
    fillPath() { this._add('fillPath', { path: this._path, color: this._fill }); }
    strokePath() { this._add('strokePath', { path: this._path, color: this._stroke, lineWidth: this._lineWidth }); }
    setTextColor(c) { this._textColor = color(c); }
    setFont(f) { this._font = font(f); }
    setFontSize(size) { this.setFont(Font.systemFont(size)); }
    setTextAlignedLeft() { this._alignment = 'left'; }
    setTextAlignedCenter() { this._alignment = 'center'; }
    setTextAlignedRight() { this._alignment = 'right'; }
    drawText(text, position) { this._add('text', { text: String(text), point: point(position), font: this._font, color: this._textColor, alignment: this._alignment }); }
    drawTextInRect(text, bounds) { this._add('text', { text: String(text), rect: rect(bounds), font: this._font, color: this._textColor, alignment: this._alignment }); }
    drawImageInRect(image, bounds) { if (!(image instanceof Image)) throw new TypeError('Expected Image.'); this._add('image', { base64: image.data.toBase64String(), rect: rect(bounds) }); }
    drawImageAtPoint(image, position) { if (!(image instanceof Image)) throw new TypeError('Expected Image.'); const size = image.size; this.drawImageInRect(image, { ...point(position), ...size }); }
    getImage() { const scale = this.respectScreenScale ? Number(runtime.context?.device?.screenScale || 1) : 1; return imageFromReply(sync('graphics.render', { width: number(this.size.width), height: number(this.size.height), scale, opaque: !!this.opaque, commands: this._commands })); }
  }

  // Original vectors, drawn in a 24-point square. Names provide compatibility;
  // these are Android equivalents and do not use the proprietary SF artwork.
  const vectors = Object.create(null), set = (names, recipe) => names.split(' ').forEach(name => { vectors[name] = recipe; });
  const line = (...coords) => { const segments = []; for (let i = 0; i < coords.length; i += 2) segments.push({ op: i ? 'line' : 'move', x: coords[i], y: coords[i + 1] }); return { op: 'strokePath', path: segments }; };
  const polygon = (...coords) => ({ op: 'fillPath', path: [...line(...coords).path, { op: 'close' }] });
  const ellipse = (x, y, width, height, fill = false) => ({ op: fill ? 'fillEllipse' : 'strokeEllipse', rect: { x, y, width, height } });
  const box = (x, y, width, height, fill = false, radius = 0) => radius ? { op: fill ? 'fillPath' : 'strokePath', path: [{ op: 'roundRect', x, y, width, height, rx: radius, ry: radius }] } : { op: fill ? 'fillRect' : 'strokeRect', rect: { x, y, width, height } };
  const curve = segments => ({ op: 'strokePath', path: segments });
  set('circle', [ellipse(3, 3, 18, 18)]); set('circle.fill', [ellipse(3, 3, 18, 18, true)]);
  set('square', [box(3, 3, 18, 18)]); set('square.fill', [box(3, 3, 18, 18, true)]);
  set('rectangle', [box(2, 5, 20, 14)]); set('rectangle.fill', [box(2, 5, 20, 14, true)]);
  set('plus', [line(12, 4, 12, 20), line(4, 12, 20, 12)]); set('minus', [line(4, 12, 20, 12)]);
  set('multiply xmark', [line(5, 5, 19, 19), line(19, 5, 5, 19)]); set('checkmark', [line(3, 12, 9, 18, 21, 5)]);
  set('chevron.right', [line(8, 4, 16, 12, 8, 20)]); set('chevron.left', [line(16, 4, 8, 12, 16, 20)]);
  set('chevron.up', [line(4, 16, 12, 8, 20, 16)]); set('chevron.down', [line(4, 8, 12, 16, 20, 8)]);
  set('arrow.right', [line(3, 12, 21, 12), line(14, 5, 21, 12, 14, 19)]); set('arrow.left', [line(21, 12, 3, 12), line(10, 5, 3, 12, 10, 19)]);
  set('arrow.up', [line(12, 21, 12, 3), line(5, 10, 12, 3, 19, 10)]); set('arrow.down', [line(12, 3, 12, 21), line(5, 14, 12, 21, 19, 14)]);
  set('arrow.up.arrow.down', [line(7, 20, 7, 4), line(3, 8, 7, 4, 11, 8), line(17, 4, 17, 20), line(13, 16, 17, 20, 21, 16)]);
  set('arrow.clockwise arrow.triangle.2.circlepath', [curve([{ op: 'move', x: 20, y: 12 }, { op: 'curve', x: 4, y: 12, c1: { x: 20, y: 23 }, c2: { x: 4, y: 23 } }, { op: 'curve', x: 19, y: 7, c1: { x: 4, y: 2 }, c2: { x: 14, y: 1 } }]), line(19, 2, 19, 8, 13, 8)]);
  set('play play.fill', [polygon(7, 3, 21, 12, 7, 21)]); set('pause pause.fill', [box(5, 4, 5, 16, true), box(14, 4, 5, 16, true)]);
  set('stop stop.fill', [box(5, 5, 14, 14, true)]); set('forward.fill', [polygon(2, 4, 12, 12, 2, 20), polygon(12, 4, 22, 12, 12, 20)]);
  set('backward.fill', [polygon(22, 4, 12, 12, 22, 20), polygon(12, 4, 2, 12, 12, 20)]);
  set('ellipsis', [ellipse(2, 10, 4, 4, true), ellipse(10, 10, 4, 4, true), ellipse(18, 10, 4, 4, true)]);
  set('line.3.horizontal', [line(3, 5, 21, 5), line(3, 12, 21, 12), line(3, 19, 21, 19)]);
  set('magnifyingglass', [ellipse(3, 3, 12, 12), line(13, 13, 21, 21)]);
  set('house house.fill', [line(2, 11, 12, 2, 22, 11), line(5, 9, 5, 21, 10, 21, 10, 14, 14, 14, 14, 21, 19, 21, 19, 9)]);
  set('person person.fill', [ellipse(8, 2, 8, 8, true), curve([{ op: 'move', x: 3, y: 22 }, { op: 'curve', x: 21, y: 22, c1: { x: 3, y: 8 }, c2: { x: 21, y: 8 } }])]);
  set('person.2 person.2.fill', [ellipse(5, 3, 7, 7, true), ellipse(14, 4, 6, 6, true), curve([{ op: 'move', x: 1, y: 22 }, { op: 'curve', x: 17, y: 22, c1: { x: 1, y: 9 }, c2: { x: 17, y: 9 } }]), line(19, 14, 22, 16, 23, 22)]);
  set('heart heart.fill', [{ op: 'fillPath', path: [{ op: 'move', x: 12, y: 21 }, { op: 'curve', x: 12, y: 7, c1: { x: -8, y: 5 }, c2: { x: 7, y: -4 } }, { op: 'curve', x: 12, y: 21, c1: { x: 17, y: -4 }, c2: { x: 32, y: 5 } }, { op: 'close' }] }]);
  set('star star.fill', [polygon(12, 2, 15, 8, 22, 9, 17, 14, 18, 22, 12, 18, 6, 22, 7, 14, 2, 9, 9, 8)]);
  set('bolt bolt.fill', [polygon(14, 1, 4, 14, 11, 14, 9, 23, 20, 10, 13, 10)]);
  set('clock clock.fill', [ellipse(2, 2, 20, 20), line(12, 5, 12, 12, 17, 15)]);
  set('calendar', [box(3, 5, 18, 17, false, 2), line(3, 10, 21, 10), line(7, 2, 7, 7), line(17, 2, 17, 7), box(7, 13, 3, 3, true), box(14, 13, 3, 3, true)]);
  set('sun.max sun.max.fill sun.min sun.min.fill', [ellipse(7, 7, 10, 10, true), ...Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4; return line(12 + Math.cos(a) * 8, 12 + Math.sin(a) * 8, 12 + Math.cos(a) * 11, 12 + Math.sin(a) * 11); })]);
  set('moon moon.fill', [{ op: 'fillPath', path: [{ op: 'move', x: 16, y: 2 }, { op: 'curve', x: 21, y: 17, c1: { x: -2, y: -1 }, c2: { x: -1, y: 28 } }, { op: 'curve', x: 16, y: 2, c1: { x: 9, y: 20 }, c2: { x: 7, y: 5 } }, { op: 'close' }] }]);
  const cloud = [{ op: 'fillPath', path: [{ op: 'move', x: 4, y: 18 }, { op: 'curve', x: 5, y: 9, c1: { x: -1, y: 16 }, c2: { x: 0, y: 9 } }, { op: 'curve', x: 17, y: 8, c1: { x: 5, y: 0 }, c2: { x: 16, y: 0 } }, { op: 'curve', x: 21, y: 18, c1: { x: 25, y: 7 }, c2: { x: 28, y: 18 } }, { op: 'close' }] }];
  set('cloud cloud.fill', cloud); set('cloud.rain cloud.rain.fill cloud.drizzle cloud.drizzle.fill', [...cloud, line(6, 20, 5, 23), line(12, 20, 11, 23), line(18, 20, 17, 23)]);
  set('cloud.bolt cloud.bolt.fill', [...cloud, polygon(13, 12, 9, 19, 13, 19, 11, 24, 18, 16, 14, 16)]);
  set('cloud.sun cloud.sun.fill', [...vectors['sun.max'].map(c => ({ ...c, transform: { scale: .65, x: 8, y: -1 } })), ...cloud]);
  set('cloud.moon cloud.moon.fill', [...vectors.moon.map(c => ({ ...c, transform: { scale: .65, x: 8, y: -1 } })), ...cloud]);
  set('cloud.snow cloud.snow.fill', [...cloud, ellipse(5, 20, 2, 2, true), ellipse(11, 21, 2, 2, true), ellipse(17, 20, 2, 2, true)]);
  set('cloud.fog cloud.fog.fill', [...cloud, line(3, 20, 21, 20), line(5, 23, 19, 23)]);
  set('wind', [line(2, 8, 17, 8), line(2, 12, 22, 12), line(2, 16, 15, 16), curve([{ op: 'move', x: 17, y: 8 }, { op: 'curve', x: 16, y: 4, c1: { x: 24, y: 8 }, c2: { x: 21, y: 1 } }])]);
  set('drop drop.fill humidity humidity.fill', [{ op: 'fillPath', path: [{ op: 'move', x: 12, y: 2 }, { op: 'curve', x: 12, y: 22, c1: { x: -3, y: 16 }, c2: { x: 3, y: 22 } }, { op: 'curve', x: 12, y: 2, c1: { x: 21, y: 22 }, c2: { x: 27, y: 16 } }, { op: 'close' }] }]);
  set('thermometer thermometer.sun thermometer.snowflake', [box(9, 2, 6, 15, false, 3), ellipse(7, 13, 10, 10), line(12, 7, 12, 18)]);
  set('snowflake', [line(12, 1, 12, 23), line(2, 6, 22, 18), line(2, 18, 22, 6), line(8, 3, 12, 7, 16, 3), line(8, 21, 12, 17, 16, 21)]);
  set('wifi', [curve([{ op: 'move', x: 2, y: 7 }, { op: 'curve', x: 22, y: 7, c1: { x: 6, y: 1 }, c2: { x: 18, y: 1 } }]), curve([{ op: 'move', x: 5, y: 11 }, { op: 'curve', x: 19, y: 11, c1: { x: 9, y: 7 }, c2: { x: 15, y: 7 } }]), curve([{ op: 'move', x: 8, y: 15 }, { op: 'curve', x: 16, y: 15, c1: { x: 11, y: 12 }, c2: { x: 13, y: 12 } }]), ellipse(10, 18, 4, 4, true)]);
  set('antenna.radiowaves.left.and.right', [line(12, 8, 12, 22), ellipse(10, 4, 4, 4, true), line(7, 3, 4, 7, 7, 11), line(17, 3, 20, 7, 17, 11)]);
  for (const level of [0, 25, 50, 75, 100]) set(`battery.${level}`, [box(1, 7, 20, 10, false, 2), box(22, 10, 2, 4, true), box(3, 9, 16 * level / 100, 6, true)]);
  set('battery.100.bolt', [...vectors['battery.100'], polygon(13, 3, 8, 13, 12, 13, 10, 22, 17, 10, 13, 10)]);
  set('lock lock.fill', [box(5, 10, 14, 12, false, 2), curve([{ op: 'move', x: 8, y: 10 }, { op: 'line', x: 8, y: 6 }, { op: 'curve', x: 16, y: 6, c1: { x: 8, y: 0 }, c2: { x: 16, y: 0 } }, { op: 'line', x: 16, y: 10 }]), ellipse(11, 14, 2, 2, true)]);
  set('lock.open lock.open.fill', [box(5, 10, 14, 12, false, 2), curve([{ op: 'move', x: 8, y: 10 }, { op: 'line', x: 8, y: 6 }, { op: 'curve', x: 17, y: 6, c1: { x: 8, y: 0 }, c2: { x: 17, y: 0 } }])]);
  set('bell bell.fill', [curve([{ op: 'move', x: 3, y: 18 }, { op: 'line', x: 6, y: 14 }, { op: 'curve', x: 18, y: 14, c1: { x: 4, y: -1 }, c2: { x: 20, y: -1 } }, { op: 'line', x: 21, y: 18 }, { op: 'close' }]), ellipse(10, 20, 4, 3, true)]);
  set('trash trash.fill', [line(3, 5, 21, 5), line(8, 2, 16, 2), line(5, 5, 7, 22, 17, 22, 19, 5), line(10, 9, 10, 18), line(14, 9, 14, 18)]);
  set('pencil square.and.pencil', [polygon(3, 17, 17, 3, 21, 7, 7, 21, 2, 22), line(15, 5, 19, 9)]);
  set('folder folder.fill', [line(2, 21, 2, 5, 9, 5, 12, 8, 22, 8, 22, 21, 2, 21)]);
  set('doc doc.fill doc.text doc.text.fill', [line(4, 2, 15, 2, 20, 7, 20, 22, 4, 22, 4, 2), line(15, 2, 15, 7, 20, 7), line(7, 12, 17, 12), line(7, 16, 17, 16)]);
  set('photo photo.fill camera camera.fill', [box(2, 5, 20, 15, false, 2), ellipse(8, 8, 8, 8), line(7, 5, 9, 2, 15, 2, 17, 5)]);
  set('location location.fill paperplane paperplane.fill', [polygon(2, 10, 22, 2, 14, 22, 11, 13)]);
  set('mappin mappin.circle', [ellipse(7, 2, 10, 10), line(12, 12, 12, 23), ellipse(10, 5, 4, 4, true)]);
  set('map map.fill', [line(2, 5, 8, 2, 16, 5, 22, 2, 22, 20, 16, 23, 8, 20, 2, 23, 2, 5), line(8, 2, 8, 20), line(16, 5, 16, 23)]);
  set('envelope envelope.fill', [box(2, 4, 20, 16, false, 2), line(2, 5, 12, 13, 22, 5)]);
  set('bubble.left bubble.left.fill message message.fill', [box(2, 3, 20, 15, false, 3), line(5, 18, 5, 23, 11, 18)]);
  set('phone phone.fill', [curve([{ op: 'move', x: 4, y: 2 }, { op: 'line', x: 8, y: 2 }, { op: 'line', x: 10, y: 8 }, { op: 'line', x: 7, y: 10 }, { op: 'curve', x: 14, y: 17, c1: { x: 8, y: 13 }, c2: { x: 11, y: 16 } }, { op: 'line', x: 16, y: 14 }, { op: 'line', x: 22, y: 16 }, { op: 'line', x: 22, y: 20 }, { op: 'curve', x: 4, y: 2, c1: { x: 12, y: 28 }, c2: { x: -4, y: 12 } }])]);
  set('iphone', [box(6, 1, 12, 22, false, 2), line(10, 4, 14, 4), ellipse(11, 19, 2, 2, true)]);
  set('desktopcomputer laptopcomputer', [box(2, 3, 20, 14, false, 1), line(12, 17, 12, 22), line(7, 22, 17, 22)]);
  set('gear gearshape gearshape.fill', [ellipse(5, 5, 14, 14), ellipse(9, 9, 6, 6), ...Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4; return line(12 + Math.cos(a) * 7, 12 + Math.sin(a) * 7, 12 + Math.cos(a) * 11, 12 + Math.sin(a) * 11); })]);
  set('globe network', [ellipse(2, 2, 20, 20), ellipse(7, 2, 10, 20), line(2, 12, 22, 12), line(4, 6, 20, 6), line(4, 18, 20, 18)]);
  set('chart.bar chart.bar.fill', [box(3, 13, 4, 9, true), box(10, 8, 4, 14, true), box(17, 2, 4, 20, true)]);
  set('chart.line.uptrend.xy', [line(2, 2, 2, 22, 22, 22), line(4, 18, 9, 12, 14, 15, 21, 5)]);
  set('link', [box(1, 8, 13, 8, false, 4), box(10, 8, 13, 8, false, 4)]);
  set('square.and.arrow.up', [line(4, 9, 4, 22, 20, 22, 20, 9), line(12, 17, 12, 2), line(7, 7, 12, 2, 17, 7)]);
  set('square.and.arrow.down', [line(4, 9, 4, 22, 20, 22, 20, 9), line(12, 2, 12, 17), line(7, 12, 12, 17, 17, 12)]);
  set('mic mic.fill', [box(8, 2, 8, 13, false, 4), curve([{ op: 'move', x: 5, y: 10 }, { op: 'curve', x: 19, y: 10, c1: { x: 4, y: 22 }, c2: { x: 20, y: 22 } }]), line(12, 19, 12, 23), line(8, 23, 16, 23)]);
  set('speaker.wave.2 speaker.wave.2.fill', [polygon(2, 8, 7, 8, 13, 3, 13, 21, 7, 16, 2, 16), curve([{ op: 'move', x: 17, y: 7 }, { op: 'curve', x: 17, y: 17, c1: { x: 21, y: 8 }, c2: { x: 21, y: 16 } }]), curve([{ op: 'move', x: 20, y: 3 }, { op: 'curve', x: 20, y: 21, c1: { x: 27, y: 7 }, c2: { x: 27, y: 17 } }])]);
  set('music.note', [line(9, 18, 9, 4, 20, 2, 20, 16), ellipse(3, 16, 6, 6, true), ellipse(14, 14, 6, 6, true)]);
  set('car car.fill', [line(2, 17, 2, 11, 5, 4, 19, 4, 22, 11, 22, 17, 2, 17), line(2, 11, 22, 11), box(3, 17, 4, 5, true), box(17, 17, 4, 5, true), ellipse(4, 13, 3, 3, true), ellipse(17, 13, 3, 3, true)]);
  set('airplane', [polygon(11, 1, 13, 1, 14, 9, 23, 15, 23, 18, 14, 14, 14, 20, 18, 23, 6, 23, 10, 20, 10, 14, 1, 18, 1, 15, 10, 9)]);
  set('book book.fill', [line(12, 5, 3, 2, 3, 20, 12, 23, 21, 20, 21, 2, 12, 5, 12, 23)]);
  set('shield shield.fill', [line(12, 2, 3, 6, 4, 15, 12, 23, 20, 15, 21, 6, 12, 2)]);
  set('flag flag.fill', [line(4, 23, 4, 2, 20, 2, 16, 7, 20, 12, 4, 12)]);
  set('exclamationmark.triangle exclamationmark.triangle.fill', [line(12, 2, 1, 22, 23, 22, 12, 2), line(12, 8, 12, 15), ellipse(11, 18, 2, 2, true)]);
  set('info', [ellipse(11, 2, 2, 2, true), line(12, 8, 12, 22)]); set('questionmark', [curve([{ op: 'move', x: 7, y: 7 }, { op: 'curve', x: 12, y: 13, c1: { x: 7, y: -3 }, c2: { x: 28, y: 4 } }, { op: 'line', x: 12, y: 16 }]), ellipse(11, 20, 2, 2, true)]);
  set('exclamationmark', [line(12, 2, 12, 16), ellipse(11, 20, 2, 2, true)]);
  for (const name of ['checkmark', 'xmark', 'plus', 'minus', 'info', 'questionmark', 'exclamationmark', 'arrow.up', 'arrow.down', 'arrow.left', 'arrow.right', 'person', 'play', 'pause']) {
    set(`${name}.circle ${name}.circle.fill`, [ellipse(1, 1, 22, 22), ...vectors[name].map(c => ({ ...c, transform: { scale: .65, x: 4.2, y: 4.2 } }))]);
  }
  class SFSymbol {
    constructor(name) { this.name = name; this._fontSize = 24; this._weight = '400'; }
    static named(name) { if (typeof name !== 'string') throw new TypeError('Symbol name must be a string.'); return vectors[name] ? new SFSymbol(name) : null; }
    applyFont(value) { const f = font(value); this._fontSize = f.size; this._weight = f.weight; }
    get image() { const weight = this._weight === 'bold' ? 700 : this._weight === 'normal' ? 400 : Number(this._weight); const commands = vectors[this.name].map(c => ({ color: '#000000ff', lineWidth: 1 + (weight || 400) / 400, ...c })); return imageFromReply(sync('graphics.symbol', { name: this.name, fontSize: this._fontSize, weight: this._weight, width: 24, height: 24, scale: this._fontSize / 24, opaque: false, commands })); }
  }
  for (const [name, weight] of Object.entries({ UltraLight: 100, Thin: 200, Light: 300, Regular: 400, Medium: 500, Semibold: 600, Bold: 700, Heavy: 800, Black: 900 })) SFSymbol.prototype[`apply${name}Weight`] = function () { this._weight = String(weight); };

  const localeOf = value => (value || runtime.context?.device?.locale || 'en-US').replace(/_/g, '-');
  const validDate = value => { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError('Expected a valid Date.'); return value; };
  const pad = (n, width = 2) => String(n).padStart(width, '0');
  function patternParts(pattern) {
    const parts = []; let i = 0;
    while (i < pattern.length) {
      if (pattern[i] === "'") { if (pattern[i + 1] === "'") { parts.push({ literal: "'" }); i += 2; continue; } let literal = ''; i++; let closed = false; while (i < pattern.length) { if (pattern[i] === "'") { if (pattern[i + 1] === "'") { literal += "'"; i += 2; } else { i++; closed = true; break; } } else literal += pattern[i++]; } if (!closed) throw new Error('Unclosed DateFormatter literal.'); parts.push({ literal }); }
      else if (/[A-Za-z]/.test(pattern[i])) { const letter = pattern[i], start = i++; while (pattern[i] === letter) i++; parts.push({ token: pattern.slice(start, i) }); }
      else { const start = i++; while (i < pattern.length && !/[A-Za-z']/.test(pattern[i])) i++; parts.push({ literal: pattern.slice(start, i) }); }
    } return parts;
  }
  class DateFormatter {
    constructor() { this.locale = localeOf(); this.dateFormat = ''; this._dateStyle = 'medium'; this._timeStyle = null; }
    _intl(options) { return new Intl.DateTimeFormat(localeOf(this.locale), { ...options, ...(this.timeZone ? { timeZone: this.timeZone } : {}) }); }
    _options() { return { ...(this._dateStyle ? { dateStyle: this._dateStyle } : {}), ...(this._timeStyle ? { timeStyle: this._timeStyle } : {}) }; }
    _nativePayload() { return { locale: localeOf(this.locale), dateFormat: this.dateFormat || '', dateStyle: this._dateStyle, timeStyle: this._timeStyle, timeZone: this.timeZone || null }; }
    _fields(date) { const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23', ...(this.timeZone ? { timeZone: this.timeZone } : {}) }).formatToParts(date); const fields = {}; for (const p of parts) if (p.type !== 'literal') fields[p.type] = Number(p.value); return fields; }
    string(date) {
      validDate(date); if (runtime.context?.nativeRuntime) return String(sync('date.format', { ...this._nativePayload(), timestamp: date.getTime() }));
      if (!this.dateFormat) { const options = this._options(); return Object.keys(options).length ? this._intl(options).format(date) : ''; }
      const f = this._fields(date), y = f.year, m = f.month, d = f.day, h = f.hour;
      const local = (options, type) => this._intl(options).formatToParts(date).find(p => p.type === type)?.value || '';
      const dayOfYear = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000) + 1;
      const tz = this.timeZone ? (Date.UTC(y, m - 1, d, h, f.minute, f.second) - Math.floor(date.getTime() / 1000) * 1000) / 60000 : -date.getTimezoneOffset();
      const offset = colon => (tz < 0 ? '-' : '+') + pad(Math.floor(Math.abs(tz) / 60)) + (colon ? ':' : '') + pad(Math.abs(tz) % 60);
      return patternParts(this.dateFormat).map(({ token: t, literal }) => {
        if (literal !== undefined) return literal; const n = t.length;
        switch (t[0]) {
          case 'y': case 'u': return n === 2 ? pad(y % 100) : pad(y, n);
          case 'M': case 'L': return n < 3 ? pad(m, n) : local({ month: n === 3 ? 'short' : n === 4 ? 'long' : 'narrow' }, 'month');
          case 'd': return pad(d, n); case 'D': return pad(dayOfYear, n);
          case 'E': case 'c': case 'e': return local({ weekday: n < 4 ? 'short' : n === 4 ? 'long' : 'narrow' }, 'weekday');
          case 'H': return pad(h, n); case 'h': return pad(h % 12 || 12, n); case 'K': return pad(h % 12, n); case 'k': return pad(h || 24, n);
          case 'm': return pad(f.minute, n); case 's': return pad(f.second, n); case 'S': return pad(date.getMilliseconds(), 3).slice(0, n).padEnd(n, '0');
          case 'a': return local({ hour: 'numeric', hour12: true }, 'dayPeriod');
          case 'G': return local({ era: n < 4 ? 'short' : n === 4 ? 'long' : 'narrow' }, 'era');
          case 'z': case 'v': return local({ timeZoneName: n < 4 ? 'short' : 'long' }, 'timeZoneName');
          case 'Z': return n === 4 ? 'GMT' + offset(true) : n === 5 ? (tz ? offset(true) : 'Z') : offset(false);
          case 'X': case 'x': return t[0] === 'X' && !tz ? 'Z' : n === 1 ? (tz % 60 ? offset(false) : offset(false).slice(0, 3)) : offset(n >= 3);
          case 'Q': case 'q': return n <= 2 ? pad(Math.ceil(m / 3), n) : n === 3 ? 'Q' + Math.ceil(m / 3) : ['1st quarter', '2nd quarter', '3rd quarter', '4th quarter'][Math.floor((m - 1) / 3)];
          default: throw new Error(`Unsupported DateFormatter token: ${t}`);
        }
      }).join('');
    }
    date(value) {
      if (typeof value !== 'string') throw new TypeError('Date string must be a string.');
      if (runtime.context?.nativeRuntime) { const timestamp = sync('date.parse', { ...this._nativePayload(), value }); return timestamp == null ? null : new Date(timestamp); }
      const localizedDigits = Array.from({ length: 10 }, (_, i) => new Intl.NumberFormat(localeOf(this.locale), { useGrouping: false }).format(i));
      for (let i = 0; i < localizedDigits.length; i++) if (localizedDigits[i] !== String(i)) value = value.split(localizedDigits[i]).join(String(i));
      let parts;
      if (this.dateFormat) parts = patternParts(this.dateFormat);
      else { const opts = this._options(); if (!Object.keys(opts).length) return null; const map = { year: 'yyyy', month: this._dateStyle === 'short' ? 'M' : this._dateStyle === 'medium' ? 'MMM' : 'MMMM', day: 'd', hour: 'h', minute: 'mm', second: 'ss', dayPeriod: 'a', weekday: 'EEEE', era: 'G', timeZoneName: 'z' }; parts = this._intl(opts).formatToParts(new Date(2026, 10, 24, 15, 42, 37)).map(p => p.type === 'literal' ? { literal: p.value } : { token: p.type === 'hour' && !this._intl(opts).resolvedOptions().hour12 ? 'H' : p.type === 'year' && p.value.length === 2 ? 'yy' : p.type === 'month' && /^\p{Number}+$/u.test(p.value) ? 'M' : map[p.type] }); }
      const captures = [], escaped = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), monthNames = length => Array.from({ length: 12 }, (_, i) => this._intl({ month: length === 3 ? 'short' : length === 4 ? 'long' : 'narrow' }).format(new Date(2020, i, 15, 12)));
      let regex = '^';
      for (const p of parts) { if (p.literal !== undefined) { regex += escaped(p.literal).replace(/\s+/g, '\\s+'); continue; } const t = p.token; if (!t) return null; captures.push(t); if ('ML'.includes(t[0]) && t.length >= 3) regex += '(' + monthNames(t.length).map(escaped).join('|') + ')'; else if ('yudDHhKkmsS'.includes(t[0]) || ('MLQq'.includes(t[0]) && t.length <= 2)) regex += '(\\d{1,' + (t[0] === 'y' || t[0] === 'u' ? Math.max(t.length, 4) : t[0] === 'S' || t[0] === 'D' ? Math.max(t.length, 3) : 2) + '})'; else if ('XxZ'.includes(t[0])) regex += '(Z|(?:GMT)?[+-]\\d{2}(?::?\\d{2})?)'; else if ('aGEec zv'.replace(/ /g, '').includes(t[0])) regex += '(.+?)'; else throw new Error(`Unsupported DateFormatter parse token: ${t}`); }
      const match = new RegExp(regex + '$', 'iu').exec(value); if (!match) return null;
      let year = 1970, month = 1, day = 1, hour = 0, minute = 0, second = 0, ms = 0, period = null, offset = null, dayYear = null, hour12 = false;
      for (let i = 0; i < captures.length; i++) { const t = captures[i], v = match[i + 1], n = Number(v); switch (t[0]) {
        case 'y': case 'u': year = t.length === 2 ? (n <= 69 ? 2000 : 1900) + n : n; break;
        case 'M': case 'L': month = t.length >= 3 ? monthNames(t.length).findIndex(m => m.toLocaleLowerCase(localeOf(this.locale)) === v.toLocaleLowerCase(localeOf(this.locale))) + 1 : n; break;
        case 'd': day = n; break; case 'D': dayYear = n; break;
        case 'h': if (n < 1 || n > 12) return null; hour = n % 12; hour12 = true; break;
        case 'K': if (n > 11) return null; hour = n; hour12 = true; break;
        case 'k': if (n < 1 || n > 24) return null; hour = n % 24; break;
        case 'H': hour = n; break; case 'm': minute = n; break; case 's': second = n; break; case 'S': ms = Number((v + '000').slice(0, 3)); break; case 'a': period = v; break;
        case 'X': case 'x': case 'Z': { if (v === 'Z') offset = 0; else { const z = /([+-])(\d{2})(?::?(\d{2}))?$/.exec(v); if (!z || +z[2] > 23 || +(z[3] || 0) > 59) return null; offset = (z[1] === '-' ? -1 : 1) * (+z[2] * 60 + +(z[3] || 0)); } break; }
        case 'z': case 'v': { if (/^(UTC|GMT)$/i.test(v)) offset = 0; else { const z = /(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?/.exec(v); if (z) offset = (z[1] === '-' ? -1 : 1) * (+z[2] * 60 + +(z[3] || 0)); else { const expected = this._intl({ timeZoneName: t.length < 4 ? 'short' : 'long' }).formatToParts(new Date(year, month - 1, day, 12)).find(p => p.type === 'timeZoneName')?.value; if (expected !== v) return null; } } break; }
        case 'G': if (/^(BC|BCE)/i.test(v)) year = 1 - year; break;
        case 'Q': case 'q': month = (n - 1) * 3 + 1; break;
      } }
      if (period && hour12) { const pm = this._intl({ hour: 'numeric', hour12: true }).formatToParts(new Date(2020, 0, 1, 15)).find(p => p.type === 'dayPeriod')?.value; const am = this._intl({ hour: 'numeric', hour12: true }).formatToParts(new Date(2020, 0, 1, 3)).find(p => p.type === 'dayPeriod')?.value; if (period.toLowerCase() === pm?.toLowerCase()) hour += 12; else if (period.toLowerCase() !== am?.toLowerCase()) return null; }
      if (dayYear != null) { if (dayYear < 1 || dayYear > (new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1 ? 366 : 365)) return null; const dy = new Date(Date.UTC(year, 0, dayYear)); month = dy.getUTCMonth() + 1; day = dy.getUTCDate(); }
      if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
      const result = new Date(0); if (offset == null && !this.timeZone) { result.setFullYear(year, month - 1, day); result.setHours(hour, minute, second, ms); if (result.getFullYear() !== year || result.getMonth() !== month - 1 || result.getDate() !== day) return null; }
      else { result.setUTCFullYear(year, month - 1, day); result.setUTCHours(hour, minute, second, ms); if (result.getUTCFullYear() !== year || result.getUTCMonth() !== month - 1 || result.getUTCDate() !== day) return null; if (offset == null) { for (let i = 0; i < 2; i++) { const f = this._fields(result), localMillis = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second), wanted = Date.UTC(year, month - 1, day, hour, minute, second); result.setTime(result.getTime() + wanted - localMillis); } } else result.setTime(result.getTime() - offset * 60000); }
      return Number.isFinite(result.getTime()) ? result : null;
    }
  }
  for (const [name, style] of Object.entries({ No: null, Short: 'short', Medium: 'medium', Long: 'long', Full: 'full' })) { DateFormatter.prototype[`use${name}DateStyle`] = function () { this._dateStyle = style; }; DateFormatter.prototype[`use${name}TimeStyle`] = function () { this._timeStyle = style; }; }
  class RelativeDateTimeFormatter {
    constructor() { this.locale = localeOf(); this._numeric = 'auto'; }
    useNamedDateTimeStyle() { this._numeric = 'auto'; }
    useNumericDateTimeStyle() { this._numeric = 'always'; }
    string(date, referenceDate) { const seconds = (validDate(date).getTime() - validDate(referenceDate).getTime()) / 1000; let unit = 'second', divisor = 1; for (const [name, size] of [['year', 31557600], ['month', 2629800], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) if (Math.abs(seconds) >= size) { unit = name; divisor = size; break; } return new Intl.RelativeTimeFormat(localeOf(this.locale), { numeric: this._numeric }).format(Math.round(seconds / divisor), unit); }
  }
  class XMLParser {
    constructor(string) { if (typeof string !== 'string') throw new TypeError('XML must be a string.'); this.string = string; this.error = null; }
    parse() {
      this.error = null; const xml = this.string.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'), stack = [], nameStart = '[:A-Z_a-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c-\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd]', name = nameStart + '(?:' + nameStart + '|[0-9.\u00b7\u0300-\u036f\u203f-\u2040-])*'; let i = 0, root = 0, declaration = false, doctype = false;
      const callback = (n, ...args) => { if (typeof this[n] === 'function') this[n](...args); };
      const fail = message => { const line = xml.slice(0, i).split('\n').length; const error = new Error(`${message} at line ${line}.`); error.line = line; throw error; };
      const entities = text => text.replace(/&([^;\s<&]*);|&/g, (all, key) => { if (!key) fail('Unterminated entity'); if (Object.prototype.hasOwnProperty.call({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }, key)) return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[key]; if (/^#(?:[0-9]+|x[0-9a-f]+)$/i.test(key)) { const n = key[1]?.toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1)); if (!(n === 9 || n === 10 || n === 13 || n >= 32 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) && n !== 0xfffe && n !== 0xffff)) fail('Invalid character entity'); return String.fromCodePoint(n); } fail(`Unknown entity &${key};`); });
      try {
        if (xml.length > 8 * 1024 * 1024) fail('XML exceeds 8 MiB'); if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(xml)) fail('Invalid XML character'); callback('didStartDocument');
        while (i < xml.length) {
          if (xml[i] !== '<') { const end = xml.indexOf('<', i), text = xml.slice(i, end < 0 ? xml.length : end); if (!stack.length && text.trim()) fail('Characters outside the root element'); if (text.includes(']]>')) fail('CDATA end in character data'); if (stack.length) callback('foundCharacters', entities(text)); i = end < 0 ? xml.length : end; continue; }
          if (xml.startsWith('<!--', i)) { const end = xml.indexOf('-->', i + 4); if (end < 0 || xml.slice(i + 4, end).includes('--')) fail('Malformed comment'); i = end + 3; continue; }
          if (xml.startsWith('<![CDATA[', i)) { if (!stack.length) fail('CDATA outside root'); const end = xml.indexOf(']]>', i + 9); if (end < 0) fail('Unclosed CDATA'); callback('foundCharacters', xml.slice(i + 9, end)); i = end + 3; continue; }
          if (xml.startsWith('<?', i)) { const end = xml.indexOf('?>', i + 2); if (end < 0) fail('Unclosed processing instruction'); const pi = xml.slice(i + 2, end), target = new RegExp('^(' + name + ')(?:\\s|$)').exec(pi); if (!target) fail('Malformed processing instruction'); if (target[1].toLowerCase() === 'xml') { if (target[1] !== 'xml' || i !== 0 || declaration || !/^xml\s+version\s*=\s*(['"])1\.[01]\1(?:\s+(?:encoding|standalone)\s*=\s*(['"])[^'"]+\2)*\s*$/.test(pi)) fail('Malformed XML declaration'); declaration = true; } i = end + 2; continue; }
          if (xml.startsWith('<!DOCTYPE', i)) { if (stack.length || root || doctype || !new RegExp('^<!DOCTYPE\\s+' + name + '(?:\\s|>|\\[)').test(xml.slice(i))) fail('Malformed or misplaced DOCTYPE'); doctype = true; let cursor = i + 9, quote = null, depth = 0; for (; cursor < xml.length; cursor++) { const ch = xml[cursor]; if (quote) { if (ch === quote) quote = null; } else if (ch === '"' || ch === "'") quote = ch; else if (ch === '[') depth++; else if (ch === ']') depth--; else if (ch === '>' && !depth) break; } if (cursor === xml.length) fail('Unclosed DOCTYPE'); if (/\b(?:SYSTEM|PUBLIC|ENTITY)\b/i.test(xml.slice(i, cursor))) fail('External or custom entities are not supported'); i = cursor + 1; continue; }
          if (xml.startsWith('</', i)) { const match = new RegExp('^<\\/(' + name + ')\\s*>').exec(xml.slice(i)); if (!match || stack.pop() !== match[1]) fail('Mismatched closing element'); callback('didEndElement', match[1]); i += match[0].length; continue; }
          const match = new RegExp('^<(' + name + ')').exec(xml.slice(i)); if (!match) fail('Malformed start tag'); if (!stack.length && root++) fail('Multiple root elements'); let cursor = i + match[0].length, attrs = Object.create(null), closed = false, empty = false;
          while (cursor < xml.length) { const space = /^\s*/.exec(xml.slice(cursor))[0]; cursor += space.length; if (xml.startsWith('/>', cursor)) { empty = true; closed = true; cursor += 2; break; } if (xml[cursor] === '>') { closed = true; cursor++; break; } if (!space) fail('Attributes require whitespace'); const a = new RegExp('^(' + name + ')\\s*=\\s*([\x22\x27])([\\s\\S]*?)\\2').exec(xml.slice(cursor)); if (!a || a[3].includes('<') || Object.hasOwn(attrs, a[1])) fail('Malformed or duplicate attribute'); attrs[a[1]] = entities(a[3].replace(/[\n\t]/g, ' ')); cursor += a[0].length; }
          if (!closed) fail('Unclosed start tag'); callback('didStartElement', match[1], attrs); if (empty) callback('didEndElement', match[1]); else { if (stack.length >= 512) fail('XML nesting exceeds 512'); stack.push(match[1]); } i = cursor;
        }
        if (stack.length || !root) fail('Missing or unclosed root element'); callback('didEndDocument'); return true;
      } catch (error) { this.error = error; callback('parseErrorOccurred', error); return false; }
    }
  }
  runtime.register({ DrawContext, Path, LinearGradient, SFSymbol, DateFormatter, RelativeDateTimeFormatter, XMLParser });
})();
