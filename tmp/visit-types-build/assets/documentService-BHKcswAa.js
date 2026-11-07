import{s}from"./supabase-CiuS_8XR.js";import{at as Sn,au as An}from"./index-BldFFIPT.js";import{g as I,E as In}from"./clinicInfoService-CqC2xvvp.js";import{c as Dn}from"./chargeService-BFTNoCy-.js";import{F as kn}from"./medicationService-Cb8MHyFt.js";var Ve={},me={},g={};Object.defineProperty(g,"__esModule",{value:!0});function Tn(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}var Pn=function t(e,n){Tn(this,t),this.data=e,this.text=n.text||e,this.options=n};g.default=Pn;Object.defineProperty(me,"__esModule",{value:!0});me.CODE39=void 0;var Rn=function(){function t(e,n){for(var r=0;r<n.length;r++){var i=n[r];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(e,i.key,i)}}return function(e,n,r){return n&&t(e.prototype,n),r&&t(e,r),e}}(),Mn=g,Cn=jn(Mn);function jn(t){return t&&t.__esModule?t:{default:t}}function Ln(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function Nn(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e&&(typeof e=="object"||typeof e=="function")?e:t}function Bn(t,e){if(typeof e!="function"&&e!==null)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e)}var zn=function(t){Bn(e,t);function e(n,r){return Ln(this,e),n=n.toUpperCase(),r.mod43&&(n+=Hn(Gn(n))),Nn(this,(e.__proto__||Object.getPrototypeOf(e)).call(this,n,r))}return Rn(e,[{key:"encode",value:function(){for(var r=Te("*"),i=0;i<this.data.length;i++)r+=Te(this.data[i])+"0";return r+=Te("*"),{data:r,text:this.text}}},{key:"valid",value:function(){return this.data.search(/^[0-9A-Z\-\.\ \$\/\+\%]+$/)!==-1}}]),e}(Cn.default),Wt=["0","1","2","3","4","5","6","7","8","9","A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z","-","."," ","$","/","+","%","*"],qn=[20957,29783,23639,30485,20951,29813,23669,20855,29789,23645,29975,23831,30533,22295,30149,24005,21623,29981,23837,22301,30023,23879,30545,22343,30161,24017,21959,30065,23921,22385,29015,18263,29141,17879,29045,18293,17783,29021,18269,17477,17489,17681,20753,35770];function Te(t){return Fn(Yt(t))}function Fn(t){return qn[t].toString(2)}function Hn(t){return Wt[t]}function Yt(t){return Wt.indexOf(t)}function Gn(t){for(var e=0,n=0;n<t.length;n++)e+=Yt(t[n]);return e=e%43,e}me.CODE39=zn;var E={},Xe={},X={},f={};Object.defineProperty(f,"__esModule",{value:!0});var Z;function Pe(t,e,n){return e in t?Object.defineProperty(t,e,{value:n,enumerable:!0,configurable:!0,writable:!0}):t[e]=n,t}var Qt=f.SET_A=0,Kt=f.SET_B=1,Jt=f.SET_C=2;f.SHIFT=98;var Un=f.START_A=103,Vn=f.START_B=104,Xn=f.START_C=105;f.MODULO=103;f.STOP=106;f.FNC1=207;f.SET_BY_CODE=(Z={},Pe(Z,Un,Qt),Pe(Z,Vn,Kt),Pe(Z,Xn,Jt),Z);f.SWAP={101:Qt,100:Kt,99:Jt};f.A_START_CHAR="Ð";f.B_START_CHAR="Ñ";f.C_START_CHAR="Ò";f.A_CHARS="[\0-_È-Ï]";f.B_CHARS="[ -È-Ï]";f.C_CHARS="(Ï*[0-9]{2}Ï*)";f.BARS=[11011001100,11001101100,11001100110,10010011e3,10010001100,10001001100,10011001e3,10011000100,10001100100,11001001e3,11001000100,11000100100,10110011100,10011011100,10011001110,10111001100,10011101100,10011100110,11001110010,11001011100,11001001110,11011100100,11001110100,11101101110,11101001100,11100101100,11100100110,11101100100,11100110100,11100110010,11011011e3,11011000110,11000110110,10100011e3,10001011e3,10001000110,10110001e3,10001101e3,10001100010,11010001e3,11000101e3,11000100010,10110111e3,10110001110,10001101110,10111011e3,10111000110,10001110110,11101110110,11010001110,11000101110,11011101e3,11011100010,11011101110,11101011e3,11101000110,11100010110,11101101e3,11101100010,11100011010,11101111010,11001000010,11110001010,1010011e4,10100001100,1001011e4,10010000110,10000101100,10000100110,1011001e4,10110000100,1001101e4,10011000010,10000110100,10000110010,11000010010,1100101e4,11110111010,11000010100,10001111010,10100111100,10010111100,10010011110,10111100100,10011110100,10011110010,11110100100,11110010100,11110010010,11011011110,11011110110,11110110110,10101111e3,10100011110,10001011110,10111101e3,10111100010,11110101e3,11110100010,10111011110,10111101110,11101011110,11110101110,11010000100,1101001e4,11010011100,1100011101011];Object.defineProperty(X,"__esModule",{value:!0});var Wn=function(){function t(e,n){for(var r=0;r<n.length;r++){var i=n[r];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(e,i.key,i)}}return function(e,n,r){return n&&t(e.prototype,n),r&&t(e,r),e}}(),Yn=g,Qn=Kn(Yn),v=f;function Kn(t){return t&&t.__esModule?t:{default:t}}function Jn(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function Zn(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e&&(typeof e=="object"||typeof e=="function")?e:t}function er(t,e){if(typeof e!="function"&&e!==null)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e)}var tr=function(t){er(e,t);function e(n,r){Jn(this,e);var i=Zn(this,(e.__proto__||Object.getPrototypeOf(e)).call(this,n.substring(1),r));return i.bytes=n.split("").map(function(a){return a.charCodeAt(0)}),i}return Wn(e,[{key:"valid",value:function(){return/^[\x00-\x7F\xC8-\xD3]+$/.test(this.data)}},{key:"encode",value:function(){var r=this.bytes,i=r.shift()-105,a=v.SET_BY_CODE[i];if(a===void 0)throw new RangeError("The encoding does not start with a start character.");this.shouldEncodeAsEan128()===!0&&r.unshift(v.FNC1);var o=e.next(r,1,a);return{text:this.text===this.data?this.text.replace(/[^\x20-\x7E]/g,""):this.text,data:e.getBar(i)+o.result+e.getBar((o.checksum+i)%v.MODULO)+e.getBar(v.STOP)}}},{key:"shouldEncodeAsEan128",value:function(){var r=this.options.ean128||!1;return typeof r=="string"&&(r=r.toLowerCase()==="true"),r}}],[{key:"getBar",value:function(r){return v.BARS[r]?v.BARS[r].toString():""}},{key:"correctIndex",value:function(r,i){if(i===v.SET_A){var a=r.shift();return a<32?a+64:a-32}else return i===v.SET_B?r.shift()-32:(r.shift()-48)*10+r.shift()-48}},{key:"next",value:function(r,i,a){if(!r.length)return{result:"",checksum:0};var o=void 0,d=void 0;if(r[0]>=200){d=r.shift()-105;var c=v.SWAP[d];c!==void 0?o=e.next(r,i+1,c):((a===v.SET_A||a===v.SET_B)&&d===v.SHIFT&&(r[0]=a===v.SET_A?r[0]>95?r[0]-96:r[0]:r[0]<32?r[0]+96:r[0]),o=e.next(r,i+1,a))}else d=e.correctIndex(r,a),o=e.next(r,i+1,a);var u=e.getBar(d),h=d*i;return{result:u+o.result,checksum:h+o.checksum}}}]),e}(Qn.default);X.default=tr;var We={};Object.defineProperty(We,"__esModule",{value:!0});var k=f,Zt=function(e){return e.match(new RegExp("^"+k.A_CHARS+"*"))[0].length},en=function(e){return e.match(new RegExp("^"+k.B_CHARS+"*"))[0].length},tn=function(e){return e.match(new RegExp("^"+k.C_CHARS+"*"))[0]};function Ye(t,e){var n=e?k.A_CHARS:k.B_CHARS,r=t.match(new RegExp("^("+n+"+?)(([0-9]{2}){2,})([^0-9]|$)"));if(r)return r[1]+"Ì"+nn(t.substring(r[1].length));var i=t.match(new RegExp("^"+n+"+"))[0];return i.length===t.length?t:i+String.fromCharCode(e?205:206)+Ye(t.substring(i.length),!e)}function nn(t){var e=tn(t),n=e.length;if(n===t.length)return t;t=t.substring(n);var r=Zt(t)>=en(t);return e+String.fromCharCode(r?206:205)+Ye(t,r)}We.default=function(t){var e=void 0,n=tn(t).length;if(n>=2)e=k.C_START_CHAR+nn(t);else{var r=Zt(t)>en(t);e=(r?k.A_START_CHAR:k.B_START_CHAR)+Ye(t,r)}return e.replace(/[\xCD\xCE]([^])[\xCD\xCE]/,function(i,a){return"Ë"+a})};Object.defineProperty(Xe,"__esModule",{value:!0});var nr=X,rr=rn(nr),ir=We,ar=rn(ir);function rn(t){return t&&t.__esModule?t:{default:t}}function or(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function Re(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e&&(typeof e=="object"||typeof e=="function")?e:t}function dr(t,e){if(typeof e!="function"&&e!==null)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e)}var lr=function(t){dr(e,t);function e(n,r){if(or(this,e),/^[\x00-\x7F\xC8-\xD3]+$/.test(n))var i=Re(this,(e.__proto__||Object.getPrototypeOf(e)).call(this,(0,ar.default)(n),r));else var i=Re(this,(e.__proto__||Object.getPrototypeOf(e)).call(this,n,r));return Re(i)}return e}(rr.default);Xe.default=lr;var Qe={};Object.defineProperty(Qe,"__esModule",{value:!0});var sr=function(){function t(e,n){for(var r=0;r<n.length;r++){var i=n[r];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(e,i.key,i)}}return function(e,n,r){return n&&t(e.prototype,n),r&&t(e,r),e}}(),cr=X,ur=fr(cr),St=f;function fr(t){return t&&t.__esModule?t:{default:t}}function pr(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function _r(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e&&(typeof e=="object"||typeof e=="function")?e:t}function hr(t,e){if(typeof e!="function"&&e!==null)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e)}var mr=function(t){hr(e,t);function e(n,r){return pr(this,e),_r(this,(e.__proto__||Object.getPrototypeOf(e)).call(this,St.A_START_CHAR+n,r))}return sr(e,[{key:"valid",value:function(){return new RegExp("^"+St.A_CHARS+"+$").test(this.data)}}]),e}(ur.default);Qe.default=mr;var Ke={};Object.defineProperty(Ke,"__esModule",{value:!0});var gr=function(){function t(e,n){for(var r=0;r<n.length;r++){var i=n[r];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(e,i.key,i)}}return function(e,n,r){return n&&t(e.prototype,n),r&&t(e,r),e}}(),br=X,yr=vr(br),At=f;function vr(t){return t&&t.__esModule?t:{default:t}}function xr(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function wr(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e&&(typeof e=="object"||typeof e=="function")?e:t}function $r(t,e){if(typeof e!="function"&&e!==null)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e)}var Er=function(t){$r(e,t);function e(n,r){return xr(this,e),wr(this,(e.__proto__||Object.getPrototypeOf(e)).call(this,At.B_START_CHAR+n,r))}return gr(e,[{key:"valid",value:function(){return new RegExp("^"+At.B_CHARS+"+$").test(this.data)}}]),e}(yr.default);Ke.default=Er;var Je={};Object.defineProperty(Je,"__esModule",{value:!0});var Or=function(){function t(e,n){for(var r=0;r<n.length;r++){var i=n[r];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(e,i.key,i)}}return function(e,n,r){return n&&t(e.prototype,n),r&&t(e,r),e}}(),Sr=X,Ar=Ir(Sr),It=f;function Ir(t){return t&&t.__esModule?t:{default:t}}function Dr(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function kr(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e&&(typeof e=="object"||typeof e=="function")?e:t}function Tr(t,e){if(typeof e!="function"&&e!==null)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e)}var Pr=function(t){Tr(e,t);function e(n,r){return Dr(this,e),kr(this,(e.__proto__||Object.getPrototypeOf(e)).call(this,It.C_START_CHAR+n,r))}return Or(e,[{key:"valid",value:function(){return new RegExp("^"+It.C_CHARS+"+$").test(this.data)}}]),e}(Ar.default);Je.default=Pr;Object.defineProperty(E,"__esModule",{value:!0});E.CODE128C=E.CODE128B=E.CODE128A=E.CODE128=void 0;var Rr=Xe,Mr=ge(Rr),Cr=Qe,jr=ge(Cr),Lr=Ke,Nr=ge(Lr),Br=Je,zr=ge(Br);function ge(t){return t&&t.__esModule?t:{default:t}}E.CODE128=Mr.default;E.CODE128A=jr.default;E.CODE128B=Nr.default;E.CODE128C=zr.default;var y={},Ze={},$={};Object.defineProperty($,"__esModule",{value:!0});$.SIDE_BIN="101";$.MIDDLE_BIN="01010";$.BINARIES={L:["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"],G:["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"],R:["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"],O:["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"],E:["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"]};$.EAN2_STRUCTURE=["LL","LG","GL","GG"];$.EAN5_STRUCTURE=["GGLLL","GLGLL","GLLGL","GLLLG","LGGLL","LLGGL","LLLGG","LGLGL","LGLLG","LLGLG"];$.EAN13_STRUCTURE=["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];var be={},j={};Object.defineProperty(j,"__esModule",{value:!0});var qr=$,Fr=function(e,n,r){var i=e.split("").map(function(o,d){return qr.BINARIES[n[d]]}).map(function(o,d){return o?o[e[d]]:""});if(r){var a=e.length-1;i=i.map(function(o,d){return d<a?o+r:o})}return i.join("")};j.default=Fr;Object.defineProperty(be,"__esModule",{value:!0});var Hr=function(){function t(e,n){for(var r=0;r<n.length;r++){var i=n[r];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(e,i.key,i)}}return function(e,n,r){return n&&t(e.prototype,n),r&&t(e,r),e}}(),B=$,Gr=j,Dt=an(Gr),Ur=g,Vr=an(Ur);function an(t){return t&&t.__esModule?t:{default:t}}function Xr(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function Wr(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e&&(typeof e=="object"||typeof e=="function")?e:t}function Yr(t,e){if(typeof e!="function"&&e!==null)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e)}var Qr=function(t){Yr(e,t);function e(n,r){Xr(this,e);var i=Wr(this,(e.__proto__||Object.getPrototypeOf(e)).call(this,n,r));return i.fontSize=!r.flat&&r.fontSize>r.width*10?r.width*10:r.fontSize,i.guardHeight=r.height+i.fontSize/2+r.textMargin,i}return Hr(e,[{key:"encode",value:function(){return this.options.flat?this.encodeFlat():this.encodeGuarded()}},{key:"leftText",value:function(r,i){return this.text.substr(r,i)}},{key:"leftEncode",value:function(r,i){return(0,Dt.default)(r,i)}},{key:"rightText",value:function(r,i){return this.text.substr(r,i)}},{key:"rightEncode",value:function(r,i){return(0,Dt.default)(r,i)}},{key:"encodeGuarded",value:function(){var r={fontSize:this.fontSize},i={height:this.guardHeight};return[{data:B.SIDE_BIN,options:i},{data:this.leftEncode(),text:this.leftText(),options:r},{data:B.MIDDLE_BIN,options:i},{data:this.rightEncode(),text:this.rightText(),options:r},{data:B.SIDE_BIN,options:i}]}},{key:"encodeFlat",value:function(){var r=[B.SIDE_BIN,this.leftEncode(),B.MIDDLE_BIN,this.rightEncode(),B.SIDE_BIN];return{data:r.join(""),text:this.text}}}]),e}(Vr.default);be.default=Qr;Object.defineProperty(Ze,"__esModule",{value:!0});var Kr=function(){function t(e,n){for(var r=0;r<n.length;r++){var i=n[r];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(e,i.key,i)}}return function(e,n,r){return n&&t(e.prototype,n),r&&t(e,r),e}}(),ee=function t(e,n,r){e===null&&(e=Function.prototype);var i=Object.getOwnPropertyDescriptor(e,n);if(i===void 0){var a=Object.getPrototypeOf(e);return a===null?void 0:t(a,n,r)}else{if("value"in i)return i.value;var o=i.get;return o===void 0?void 0:o.call(r)}},Jr=$,Zr=be,ei=ti(Zr);function ti(t){return t&&t.__esModule?t:{default:t}}function ni(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function ri(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e&&(typeof e=="object"||typeof e=="function")?e:t}function ii(t,e){if(typeof e!="function"&&e!==null)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e)}var kt=function(e){var n=e.substr(0,12).split("").map(function(r){return+r}).reduce(function(r,i,a){return a%2?r+i*3:r+i},0);return(10-n%10)%10},ai=function(t){ii(e,t);function e(n,r){ni(this,e),n.search(/^[0-9]{12}$/)!==-1&&(n+=kt(n));var i=ri(this,(e.__proto__||Object.getPrototypeOf(e)).call(this,n,r));return i.lastChar=r.lastChar,i}return Kr(e,[{key:"valid",value:function(){return this.data.search(/^[0-9]{13}$/)!==-1&&+this.data[12]===kt(this.data)}},{key:"leftText",value:function(){return ee(e.prototype.__proto__||Object.getPrototypeOf(e.prototype),"leftText",this).call(this,1,6)}},{key:"leftEncode",value:function(){var r=this.data.substr(1,6),i=Jr.EAN13_STRUCTURE[this.data[0]];return ee(e.prototype.__proto__||Object.getPrototypeOf(e.prototype),"leftEncode",this).call(this,r,i)}},{key:"rightText",value:function(){return ee(e.prototype.__proto__||Object.getPrototypeOf(e.prototype),"rightText",this).call(this,7,6)}},{key:"rightEncode",value:function(){var r=this.data.substr(7,6);return ee(e.prototype.__proto__||Object.getPrototypeOf(e.prototype),"rightEncode",this).call(this,r,"RRRRRR")}},{key:"encodeGuarded",value:function(){var r=ee(e.prototype.__proto__||Object.getPrototypeOf(e.prototype),"encodeGuarded",this).call(this);return this.options.displayValue&&(r.unshift({data:"000000000000",text:this.text.substr(0,1),options:{textAlign:"left",fontSize:this.fontSize}}),this.options.lastChar&&(r.push({data:"00"}),r.push({data:"00000",text:this.options.lastChar,options:{fontSize:this.fontSize}}))),r}}]),e}(ei.default);Ze.default=ai;var et={};Object.defineProperty(et,"__esModule",{value:!0});var oi=function(){function t(e,n){for(var r=0;r<n.length;r++){var i=n[r];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(e,i.key,i)}}return function(e,n,r){return n&&t(e.prototype,n),r&&t(e,r),e}}(),ue=function t(e,n,r){e===null&&(e=Function.prototype);var i=Object.getOwnPropertyDescriptor(e,n);if(i===void 0){var a=Object.getPrototypeOf(e);return a===null?void 0:t(a,n,r)}else{if("value"in i)return i.value;var o=i.get;return o===void 0?void 0:o.call(r)}},di=be,li=si(di);function si(t){return t&&t.__esModule?t:{default:t}}function ci(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function ui(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e&&(typeof e=="object"||typeof e=="function")?e:t}function fi(t,e){if(typeof e!="function"&&e!==null)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e)}var Tt=function(e){var n=e.substr(0,7).split("").map(function(r){return+r}).reduce(function(r,i,a){return a%2?r+i:r+i*3},0);return(10-n%10)%10},pi=function(t){fi(e,t);function e(n,r){return ci(this,e),n.search(/^[0-9]{7}$/)!==-1&&(n+=Tt(n)),ui(this,(e.__proto__||Object.getPrototypeOf(e)).call(this,n,r))}return oi(e,[{key:"valid",value:function(){return this.data.search(/^[0-9]{8}$/)!==-1&&+this.data[7]===Tt(this.data)}},{key:"leftText",value:function(){return ue(e.prototype.__proto__||Object.getPrototypeOf(e.prototype),"leftText",this).call(this,0,4)}},{key:"leftEncode",value:function(){var r=this.data.substr(0,4);return ue(e.prototype.__proto__||Object.getPrototypeOf(e.prototype),"leftEncode",this).call(this,r,"LLLL")}},{key:"rightText",value:function(){return ue(e.prototype.__proto__||Object.getPrototypeOf(e.prototype),"rightText",this).call(this,4,4)}},{key:"rightEncode",value:function(){var r=this.data.substr(4,4);return ue(e.prototype.__proto__||Object.getPrototypeOf(e.prototype),"rightEncode",this).call(this,r,"RRRR")}}]),e}(li.default);et.default=pi;var tt={};Object.defineProperty(tt,"__esModule",{value:!0});var _i=function(){function t(e,n){for(var r=0;r<n.length;r++){var i=n[r];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(e,i.key,i)}}return function(e,n,r){return n&&t(e.prototype,n),r&&t(e,r),e}}(),hi=$,mi=j,gi=on(mi),bi=g,yi=on(bi);function on(t){return t&&t.__esModule?t:{default:t}}function vi(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function xi(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e&&(typeof e=="object"||typeof e=="function")?e:t}function wi(t,e){if(typeof e!="function"&&e!==null)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e)}var $i=function(e){var n=e.split("").map(function(r){return+r}).reduce(function(r,i,a){return a%2?r+i*9:r+i*3},0);return n%10},Ei=function(t){wi(e,t);function e(n,r){return vi(this,e),xi(this,(e.__proto__||Object.getPrototypeOf(e)).call(this,n,r))}return _i(e,[{key:"valid",value:function(){return this.data.search(/^[0-9]{5}$/)!==-1}},{key:"encode",value:function(){var r=hi.EAN5_STRUCTURE[$i(this.data)];return{data:"1011"+(0,gi.default)(this.data,r,"01"),text:this.text}}}]),e}(yi.default);tt.default=Ei;var nt={};Object.defineProperty(nt,"__esModule",{value:!0});var Oi=function(){function t(e,n){for(var r=0;r<n.length;r++){var i=n[r];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(e,i.key,i)}}return function(e,n,r){return n&&t(e.prototype,n),r&&t(e,r),e}}(),Si=$,Ai=j,Ii=dn(Ai),Di=g,ki=dn(Di);function dn(t){return t&&t.__esModule?t:{default:t}}function Ti(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function Pi(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e&&(typeof e=="object"||typeof e=="function")?e:t}function Ri(t,e){if(typeof e!="function"&&e!==null)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e)}var Mi=function(t){Ri(e,t);function e(n,r){return Ti(this,e),Pi(this,(e.__proto__||Object.getPrototypeOf(e)).call(this,n,r))}return Oi(e,[{key:"valid",value:function(){return this.data.search(/^[0-9]{2}$/)!==-1}},{key:"encode",value:function(){var r=Si.EAN2_STRUCTURE[parseInt(this.data)%4];return{data:"1011"+(0,Ii.default)(this.data,r,"01"),text:this.text}}}]),e}(ki.default);nt.default=Mi;var ie={};Object.defineProperty(ie,"__esModule",{value:!0});var Ci=function(){function t(e,n){for(var r=0;r<n.length;r++){var i=n[r];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(e,i.key,i)}}return function(e,n,r){return n&&t(e.prototype,n),r&&t(e,r),e}}();ie.checksum=He;var ji=j,z=ln(ji),Li=g,Ni=ln(Li);function ln(t){return t&&t.__esModule?t:{default:t}}function Bi(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function zi(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e&&(typeof e=="object"||typeof e=="function")?e:t}function qi(t,e){if(typeof e!="function"&&e!==null)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e)}var Fi=function(t){qi(e,t);function e(n,r){Bi(this,e),n.search(/^[0-9]{11}$/)!==-1&&(n+=He(n));var i=zi(this,(e.__proto__||Object.getPrototypeOf(e)).call(this,n,r));return i.displayValue=r.displayValue,r.fontSize>r.width*10?i.fontSize=r.width*10:i.fontSize=r.fontSize,i.guardHeight=r.height+i.fontSize/2+r.textMargin,i}return Ci(e,[{key:"valid",value:function(){return this.data.search(/^[0-9]{12}$/)!==-1&&this.data[11]==He(this.data)}},{key:"encode",value:function(){return this.options.flat?this.flatEncoding():this.guardedEncoding()}},{key:"flatEncoding",value:function(){var r="";return r+="101",r+=(0,z.default)(this.data.substr(0,6),"LLLLLL"),r+="01010",r+=(0,z.default)(this.data.substr(6,6),"RRRRRR"),r+="101",{data:r,text:this.text}}},{key:"guardedEncoding",value:function(){var r=[];return this.displayValue&&r.push({data:"00000000",text:this.text.substr(0,1),options:{textAlign:"left",fontSize:this.fontSize}}),r.push({data:"101"+(0,z.default)(this.data[0],"L"),options:{height:this.guardHeight}}),r.push({data:(0,z.default)(this.data.substr(1,5),"LLLLL"),text:this.text.substr(1,5),options:{fontSize:this.fontSize}}),r.push({data:"01010",options:{height:this.guardHeight}}),r.push({data:(0,z.default)(this.data.substr(6,5),"RRRRR"),text:this.text.substr(6,5),options:{fontSize:this.fontSize}}),r.push({data:(0,z.default)(this.data[11],"R")+"101",options:{height:this.guardHeight}}),this.displayValue&&r.push({data:"00000000",text:this.text.substr(11,1),options:{textAlign:"right",fontSize:this.fontSize}}),r}}]),e}(Ni.default);function He(t){var e=0,n;for(n=1;n<11;n+=2)e+=parseInt(t[n]);for(n=0;n<11;n+=2)e+=parseInt(t[n])*3;return(10-e%10)%10}ie.default=Fi;var rt={};Object.defineProperty(rt,"__esModule",{value:!0});var Hi=function(){function t(e,n){for(var r=0;r<n.length;r++){var i=n[r];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(e,i.key,i)}}return function(e,n,r){return n&&t(e.prototype,n),r&&t(e,r),e}}(),Gi=j,Ui=sn(Gi),Vi=g,Xi=sn(Vi),Wi=ie;function sn(t){return t&&t.__esModule?t:{default:t}}function Yi(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function Me(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e&&(typeof e=="object"||typeof e=="function")?e:t}function Qi(t,e){if(typeof e!="function"&&e!==null)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e)}var Ki=["XX00000XXX","XX10000XXX","XX20000XXX","XXX00000XX","XXXX00000X","XXXXX00005","XXXXX00006","XXXXX00007","XXXXX00008","XXXXX00009"],Ji=[["EEEOOO","OOOEEE"],["EEOEOO","OOEOEE"],["EEOOEO","OOEEOE"],["EEOOOE","OOEEEO"],["EOEEOO","OEOOEE"],["EOOEEO","OEEOOE"],["EOOOEE","OEEEOO"],["EOEOEO","OEOEOE"],["EOEOOE","OEOEEO"],["EOOEOE","OEEOEO"]],Zi=function(t){Qi(e,t);function e(n,r){Yi(this,e);var i=Me(this,(e.__proto__||Object.getPrototypeOf(e)).call(this,n,r));if(i.isValid=!1,n.search(/^[0-9]{6}$/)!==-1)i.middleDigits=n,i.upcA=Pt(n,"0"),i.text=r.text||""+i.upcA[0]+n+i.upcA[i.upcA.length-1],i.isValid=!0;else if(n.search(/^[01][0-9]{7}$/)!==-1)if(i.middleDigits=n.substring(1,n.length-1),i.upcA=Pt(i.middleDigits,n[0]),i.upcA[i.upcA.length-1]===n[n.length-1])i.isValid=!0;else return Me(i);else return Me(i);return i.displayValue=r.displayValue,r.fontSize>r.width*10?i.fontSize=r.width*10:i.fontSize=r.fontSize,i.guardHeight=r.height+i.fontSize/2+r.textMargin,i}return Hi(e,[{key:"valid",value:function(){return this.isValid}},{key:"encode",value:function(){return this.options.flat?this.flatEncoding():this.guardedEncoding()}},{key:"flatEncoding",value:function(){var r="";return r+="101",r+=this.encodeMiddleDigits(),r+="010101",{data:r,text:this.text}}},{key:"guardedEncoding",value:function(){var r=[];return this.displayValue&&r.push({data:"00000000",text:this.text[0],options:{textAlign:"left",fontSize:this.fontSize}}),r.push({data:"101",options:{height:this.guardHeight}}),r.push({data:this.encodeMiddleDigits(),text:this.text.substring(1,7),options:{fontSize:this.fontSize}}),r.push({data:"010101",options:{height:this.guardHeight}}),this.displayValue&&r.push({data:"00000000",text:this.text[7],options:{textAlign:"right",fontSize:this.fontSize}}),r}},{key:"encodeMiddleDigits",value:function(){var r=this.upcA[0],i=this.upcA[this.upcA.length-1],a=Ji[parseInt(i)][parseInt(r)];return(0,Ui.default)(this.middleDigits,a)}}]),e}(Xi.default);function Pt(t,e){for(var n=parseInt(t[t.length-1]),r=Ki[n],i="",a=0,o=0;o<r.length;o++){var d=r[o];d==="X"?i+=t[a++]:i+=d}return i=""+e+i,""+i+(0,Wi.checksum)(i)}rt.default=Zi;Object.defineProperty(y,"__esModule",{value:!0});y.UPCE=y.UPC=y.EAN2=y.EAN5=y.EAN8=y.EAN13=void 0;var ea=Ze,ta=W(ea),na=et,ra=W(na),ia=tt,aa=W(ia),oa=nt,da=W(oa),la=ie,sa=W(la),ca=rt,ua=W(ca);function W(t){return t&&t.__esModule?t:{default:t}}y.EAN13=ta.default;y.EAN8=ra.default;y.EAN5=aa.default;y.EAN2=da.default;y.UPC=sa.default;y.UPCE=ua.default;var G={},ye={},ae={};Object.defineProperty(ae,"__esModule",{value:!0});ae.START_BIN="1010";ae.END_BIN="11101";ae.BINARIES=["00110","10001","01001","11000","00101","10100","01100","00011","10010","01010"];Object.defineProperty(ye,"__esModule",{value:!0});var fa=function(){function t(e,n){for(var r=0;r<n.length;r++){var i=n[r];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(e,i.key,i)}}return function(e,n,r){return n&&t(e.prototype,n),r&&t(e,r),e}}(),fe=ae,pa=g,_a=ha(pa);function ha(t){return t&&t.__esModule?t:{default:t}}function ma(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function ga(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e&&(typeof e=="object"||typeof e=="function")?e:t}function ba(t,e){if(typeof e!="function"&&e!==null)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e)}var ya=function(t){ba(e,t);function e(){return ma(this,e),ga(this,(e.__proto__||Object.getPrototypeOf(e)).apply(this,arguments))}return fa(e,[{key:"valid",value:function(){return this.data.search(/^([0-9]{2})+$/)!==-1}},{key:"encode",value:function(){var r=this,i=this.data.match(/.{2}/g).map(function(a){return r.encodePair(a)}).join("");return{data:fe.START_BIN+i+fe.END_BIN,text:this.text}}},{key:"encodePair",value:function(r){var i=fe.BINARIES[r[1]];return fe.BINARIES[r[0]].split("").map(function(a,o){return(a==="1"?"111":"1")+(i[o]==="1"?"000":"0")}).join("")}}]),e}(_a.default);ye.default=ya;var it={};Object.defineProperty(it,"__esModule",{value:!0});var va=function(){function t(e,n){for(var r=0;r<n.length;r++){var i=n[r];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(e,i.key,i)}}return function(e,n,r){return n&&t(e.prototype,n),r&&t(e,r),e}}(),xa=ye,wa=$a(xa);function $a(t){return t&&t.__esModule?t:{default:t}}function Ea(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function Oa(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e&&(typeof e=="object"||typeof e=="function")?e:t}function Sa(t,e){if(typeof e!="function"&&e!==null)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e)}var Rt=function(e){var n=e.substr(0,13).split("").map(function(r){return parseInt(r,10)}).reduce(function(r,i,a){return r+i*(3-a%2*2)},0);return Math.ceil(n/10)*10-n},Aa=function(t){Sa(e,t);function e(n,r){return Ea(this,e),n.search(/^[0-9]{13}$/)!==-1&&(n+=Rt(n)),Oa(this,(e.__proto__||Object.getPrototypeOf(e)).call(this,n,r))}return va(e,[{key:"valid",value:function(){return this.data.search(/^[0-9]{14}$/)!==-1&&+this.data[13]===Rt(this.data)}}]),e}(wa.default);it.default=Aa;Object.defineProperty(G,"__esModule",{value:!0});G.ITF14=G.ITF=void 0;var Ia=ye,Da=cn(Ia),ka=it,Ta=cn(ka);function cn(t){return t&&t.__esModule?t:{default:t}}G.ITF=Da.default;G.ITF14=Ta.default;var w={},L={};Object.defineProperty(L,"__esModule",{value:!0});var Pa=function(){function t(e,n){for(var r=0;r<n.length;r++){var i=n[r];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(e,i.key,i)}}return function(e,n,r){return n&&t(e.prototype,n),r&&t(e,r),e}}(),Ra=g,Ma=Ca(Ra);function Ca(t){return t&&t.__esModule?t:{default:t}}function ja(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function La(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e&&(typeof e=="object"||typeof e=="function")?e:t}function Na(t,e){if(typeof e!="function"&&e!==null)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e)}var Ba=function(t){Na(e,t);function e(n,r){return ja(this,e),La(this,(e.__proto__||Object.getPrototypeOf(e)).call(this,n,r))}return Pa(e,[{key:"encode",value:function(){for(var r="110",i=0;i<this.data.length;i++){var a=parseInt(this.data[i]),o=a.toString(2);o=za(o,4-o.length);for(var d=0;d<o.length;d++)r+=o[d]=="0"?"100":"110"}return r+="1001",{data:r,text:this.text}}},{key:"valid",value:function(){return this.data.search(/^[0-9]+$/)!==-1}}]),e}(Ma.default);function za(t,e){for(var n=0;n<e;n++)t="0"+t;return t}L.default=Ba;var at={},N={};Object.defineProperty(N,"__esModule",{value:!0});N.mod10=qa;N.mod11=Fa;function qa(t){for(var e=0,n=0;n<t.length;n++){var r=parseInt(t[n]);(n+t.length)%2===0?e+=r:e+=r*2%10+Math.floor(r*2/10)}return(10-e%10)%10}function Fa(t){for(var e=0,n=[2,3,4,5,6,7],r=0;r<t.length;r++){var i=parseInt(t[t.length-1-r]);e+=n[r%n.length]*i}return(11-e%11)%11}Object.defineProperty(at,"__esModule",{value:!0});var Ha=L,Ga=Va(Ha),Ua=N;function Va(t){return t&&t.__esModule?t:{default:t}}function Xa(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function Wa(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e&&(typeof e=="object"||typeof e=="function")?e:t}function Ya(t,e){if(typeof e!="function"&&e!==null)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e)}var Qa=function(t){Ya(e,t);function e(n,r){return Xa(this,e),Wa(this,(e.__proto__||Object.getPrototypeOf(e)).call(this,n+(0,Ua.mod10)(n),r))}return e}(Ga.default);at.default=Qa;var ot={};Object.defineProperty(ot,"__esModule",{value:!0});var Ka=L,Ja=eo(Ka),Za=N;function eo(t){return t&&t.__esModule?t:{default:t}}function to(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function no(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e&&(typeof e=="object"||typeof e=="function")?e:t}function ro(t,e){if(typeof e!="function"&&e!==null)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e)}var io=function(t){ro(e,t);function e(n,r){return to(this,e),no(this,(e.__proto__||Object.getPrototypeOf(e)).call(this,n+(0,Za.mod11)(n),r))}return e}(Ja.default);ot.default=io;var dt={};Object.defineProperty(dt,"__esModule",{value:!0});var ao=L,oo=lo(ao),Mt=N;function lo(t){return t&&t.__esModule?t:{default:t}}function so(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function co(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e&&(typeof e=="object"||typeof e=="function")?e:t}function uo(t,e){if(typeof e!="function"&&e!==null)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e)}var fo=function(t){uo(e,t);function e(n,r){return so(this,e),n+=(0,Mt.mod10)(n),n+=(0,Mt.mod10)(n),co(this,(e.__proto__||Object.getPrototypeOf(e)).call(this,n,r))}return e}(oo.default);dt.default=fo;var lt={};Object.defineProperty(lt,"__esModule",{value:!0});var po=L,_o=ho(po),Ct=N;function ho(t){return t&&t.__esModule?t:{default:t}}function mo(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function go(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e&&(typeof e=="object"||typeof e=="function")?e:t}function bo(t,e){if(typeof e!="function"&&e!==null)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e)}var yo=function(t){bo(e,t);function e(n,r){return mo(this,e),n+=(0,Ct.mod11)(n),n+=(0,Ct.mod10)(n),go(this,(e.__proto__||Object.getPrototypeOf(e)).call(this,n,r))}return e}(_o.default);lt.default=yo;Object.defineProperty(w,"__esModule",{value:!0});w.MSI1110=w.MSI1010=w.MSI11=w.MSI10=w.MSI=void 0;var vo=L,xo=oe(vo),wo=at,$o=oe(wo),Eo=ot,Oo=oe(Eo),So=dt,Ao=oe(So),Io=lt,Do=oe(Io);function oe(t){return t&&t.__esModule?t:{default:t}}w.MSI=xo.default;w.MSI10=$o.default;w.MSI11=Oo.default;w.MSI1010=Ao.default;w.MSI1110=Do.default;var ve={};Object.defineProperty(ve,"__esModule",{value:!0});ve.pharmacode=void 0;var ko=function(){function t(e,n){for(var r=0;r<n.length;r++){var i=n[r];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(e,i.key,i)}}return function(e,n,r){return n&&t(e.prototype,n),r&&t(e,r),e}}(),To=g,Po=Ro(To);function Ro(t){return t&&t.__esModule?t:{default:t}}function Mo(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function Co(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e&&(typeof e=="object"||typeof e=="function")?e:t}function jo(t,e){if(typeof e!="function"&&e!==null)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e)}var Lo=function(t){jo(e,t);function e(n,r){Mo(this,e);var i=Co(this,(e.__proto__||Object.getPrototypeOf(e)).call(this,n,r));return i.number=parseInt(n,10),i}return ko(e,[{key:"encode",value:function(){for(var r=this.number,i="";!isNaN(r)&&r!=0;)r%2===0?(i="11100"+i,r=(r-2)/2):(i="100"+i,r=(r-1)/2);return i=i.slice(0,-2),{data:i,text:this.text}}},{key:"valid",value:function(){return this.number>=3&&this.number<=131070}}]),e}(Po.default);ve.pharmacode=Lo;var xe={};Object.defineProperty(xe,"__esModule",{value:!0});xe.codabar=void 0;var No=function(){function t(e,n){for(var r=0;r<n.length;r++){var i=n[r];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(e,i.key,i)}}return function(e,n,r){return n&&t(e.prototype,n),r&&t(e,r),e}}(),Bo=g,zo=qo(Bo);function qo(t){return t&&t.__esModule?t:{default:t}}function Fo(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function Ho(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e&&(typeof e=="object"||typeof e=="function")?e:t}function Go(t,e){if(typeof e!="function"&&e!==null)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e)}var Uo=function(t){Go(e,t);function e(n,r){Fo(this,e),n.search(/^[0-9\-\$\:\.\+\/]+$/)===0&&(n="A"+n+"A");var i=Ho(this,(e.__proto__||Object.getPrototypeOf(e)).call(this,n.toUpperCase(),r));return i.text=i.options.text||i.text.replace(/[A-D]/g,""),i}return No(e,[{key:"valid",value:function(){return this.data.search(/^[A-D][0-9\-\$\:\.\+\/]+[A-D]$/)!==-1}},{key:"encode",value:function(){for(var r=[],i=this.getEncodings(),a=0;a<this.data.length;a++)r.push(i[this.data.charAt(a)]),a!==this.data.length-1&&r.push("0");return{text:this.text,data:r.join("")}}},{key:"getEncodings",value:function(){return{0:"101010011",1:"101011001",2:"101001011",3:"110010101",4:"101101001",5:"110101001",6:"100101011",7:"100101101",8:"100110101",9:"110100101","-":"101001101",$:"101100101",":":"1101011011","/":"1101101011",".":"1101101101","+":"1011011011",A:"1011001001",B:"1001001011",C:"1010010011",D:"1010011001"}}}]),e}(zo.default);xe.codabar=Uo;var U={},we={},de={};Object.defineProperty(de,"__esModule",{value:!0});de.SYMBOLS=["0","1","2","3","4","5","6","7","8","9","A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z","-","."," ","$","/","+","%","($)","(%)","(/)","(+)","ÿ"];de.BINARIES=["100010100","101001000","101000100","101000010","100101000","100100100","100100010","101010000","100010010","100001010","110101000","110100100","110100010","110010100","110010010","110001010","101101000","101100100","101100010","100110100","100011010","101011000","101001100","101000110","100101100","100010110","110110100","110110010","110101100","110100110","110010110","110011010","101101100","101100110","100110110","100111010","100101110","111010100","111010010","111001010","101101110","101110110","110101110","100100110","111011010","111010110","100110010","101011110"];de.MULTI_SYMBOLS={"\0":["(%)","U"],"":["($)","A"],"":["($)","B"],"":["($)","C"],"":["($)","D"],"":["($)","E"],"":["($)","F"],"\x07":["($)","G"],"\b":["($)","H"],"	":["($)","I"],"\n":["($)","J"],"\v":["($)","K"],"\f":["($)","L"],"\r":["($)","M"],"":["($)","N"],"":["($)","O"],"":["($)","P"],"":["($)","Q"],"":["($)","R"],"":["($)","S"],"":["($)","T"],"":["($)","U"],"":["($)","V"],"":["($)","W"],"":["($)","X"],"":["($)","Y"],"":["($)","Z"],"\x1B":["(%)","A"],"":["(%)","B"],"":["(%)","C"],"":["(%)","D"],"":["(%)","E"],"!":["(/)","A"],'"':["(/)","B"],"#":["(/)","C"],"&":["(/)","F"],"'":["(/)","G"],"(":["(/)","H"],")":["(/)","I"],"*":["(/)","J"],",":["(/)","L"],":":["(/)","Z"],";":["(%)","F"],"<":["(%)","G"],"=":["(%)","H"],">":["(%)","I"],"?":["(%)","J"],"@":["(%)","V"],"[":["(%)","K"],"\\":["(%)","L"],"]":["(%)","M"],"^":["(%)","N"],_:["(%)","O"],"`":["(%)","W"],a:["(+)","A"],b:["(+)","B"],c:["(+)","C"],d:["(+)","D"],e:["(+)","E"],f:["(+)","F"],g:["(+)","G"],h:["(+)","H"],i:["(+)","I"],j:["(+)","J"],k:["(+)","K"],l:["(+)","L"],m:["(+)","M"],n:["(+)","N"],o:["(+)","O"],p:["(+)","P"],q:["(+)","Q"],r:["(+)","R"],s:["(+)","S"],t:["(+)","T"],u:["(+)","U"],v:["(+)","V"],w:["(+)","W"],x:["(+)","X"],y:["(+)","Y"],z:["(+)","Z"],"{":["(%)","P"],"|":["(%)","Q"],"}":["(%)","R"],"~":["(%)","S"],"":["(%)","T"]};Object.defineProperty(we,"__esModule",{value:!0});var Vo=function(){function t(e,n){for(var r=0;r<n.length;r++){var i=n[r];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(e,i.key,i)}}return function(e,n,r){return n&&t(e.prototype,n),r&&t(e,r),e}}(),pe=de,Xo=g,Wo=Yo(Xo);function Yo(t){return t&&t.__esModule?t:{default:t}}function Qo(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function Ko(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e&&(typeof e=="object"||typeof e=="function")?e:t}function Jo(t,e){if(typeof e!="function"&&e!==null)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e)}var Zo=function(t){Jo(e,t);function e(n,r){return Qo(this,e),Ko(this,(e.__proto__||Object.getPrototypeOf(e)).call(this,n,r))}return Vo(e,[{key:"valid",value:function(){return/^[0-9A-Z\-. $/+%]+$/.test(this.data)}},{key:"encode",value:function(){var r=this.data.split("").flatMap(function(d){return pe.MULTI_SYMBOLS[d]||d}),i=r.map(function(d){return e.getEncoding(d)}).join(""),a=e.checksum(r,20),o=e.checksum(r.concat(a),15);return{text:this.text,data:e.getEncoding("ÿ")+i+e.getEncoding(a)+e.getEncoding(o)+e.getEncoding("ÿ")+"1"}}}],[{key:"getEncoding",value:function(r){return pe.BINARIES[e.symbolValue(r)]}},{key:"getSymbol",value:function(r){return pe.SYMBOLS[r]}},{key:"symbolValue",value:function(r){return pe.SYMBOLS.indexOf(r)}},{key:"checksum",value:function(r,i){var a=r.slice().reverse().reduce(function(o,d,c){var u=c%i+1;return o+e.symbolValue(d)*u},0);return e.getSymbol(a%47)}}]),e}(Wo.default);we.default=Zo;var st={};Object.defineProperty(st,"__esModule",{value:!0});var ed=function(){function t(e,n){for(var r=0;r<n.length;r++){var i=n[r];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(e,i.key,i)}}return function(e,n,r){return n&&t(e.prototype,n),r&&t(e,r),e}}(),td=we,nd=rd(td);function rd(t){return t&&t.__esModule?t:{default:t}}function id(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function ad(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e&&(typeof e=="object"||typeof e=="function")?e:t}function od(t,e){if(typeof e!="function"&&e!==null)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e)}var dd=function(t){od(e,t);function e(n,r){return id(this,e),ad(this,(e.__proto__||Object.getPrototypeOf(e)).call(this,n,r))}return ed(e,[{key:"valid",value:function(){return/^[\x00-\x7f]+$/.test(this.data)}}]),e}(nd.default);st.default=dd;Object.defineProperty(U,"__esModule",{value:!0});U.CODE93FullASCII=U.CODE93=void 0;var ld=we,sd=un(ld),cd=st,ud=un(cd);function un(t){return t&&t.__esModule?t:{default:t}}U.CODE93=sd.default;U.CODE93FullASCII=ud.default;var $e={};Object.defineProperty($e,"__esModule",{value:!0});$e.GenericBarcode=void 0;var fd=function(){function t(e,n){for(var r=0;r<n.length;r++){var i=n[r];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(e,i.key,i)}}return function(e,n,r){return n&&t(e.prototype,n),r&&t(e,r),e}}(),pd=g,_d=hd(pd);function hd(t){return t&&t.__esModule?t:{default:t}}function md(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function gd(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e&&(typeof e=="object"||typeof e=="function")?e:t}function bd(t,e){if(typeof e!="function"&&e!==null)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e)}var yd=function(t){bd(e,t);function e(n,r){return md(this,e),gd(this,(e.__proto__||Object.getPrototypeOf(e)).call(this,n,r))}return fd(e,[{key:"encode",value:function(){return{data:"10101010101010101010101010101010101010101",text:this.text}}},{key:"valid",value:function(){return!0}}]),e}(_d.default);$e.GenericBarcode=yd;Object.defineProperty(Ve,"__esModule",{value:!0});var vd=me,_e=E,q=y,jt=G,te=w,xd=ve,wd=xe,Lt=U,$d=$e;Ve.default={CODE39:vd.CODE39,CODE128:_e.CODE128,CODE128A:_e.CODE128A,CODE128B:_e.CODE128B,CODE128C:_e.CODE128C,EAN13:q.EAN13,EAN8:q.EAN8,EAN5:q.EAN5,EAN2:q.EAN2,UPC:q.UPC,UPCE:q.UPCE,ITF14:jt.ITF14,ITF:jt.ITF,MSI:te.MSI,MSI10:te.MSI10,MSI11:te.MSI11,MSI1010:te.MSI1010,MSI1110:te.MSI1110,pharmacode:xd.pharmacode,codabar:wd.codabar,CODE93:Lt.CODE93,CODE93FullASCII:Lt.CODE93FullASCII,GenericBarcode:$d.GenericBarcode};var Y={};Object.defineProperty(Y,"__esModule",{value:!0});var Ed=Object.assign||function(t){for(var e=1;e<arguments.length;e++){var n=arguments[e];for(var r in n)Object.prototype.hasOwnProperty.call(n,r)&&(t[r]=n[r])}return t};Y.default=function(t,e){return Ed({},t,e)};var ct={};Object.defineProperty(ct,"__esModule",{value:!0});ct.default=Od;function Od(t){var e=[];function n(r){if(Array.isArray(r))for(var i=0;i<r.length;i++)n(r[i]);else r.text=r.text||"",r.data=r.data||"",e.push(r)}return n(t),e}var ut={};Object.defineProperty(ut,"__esModule",{value:!0});ut.default=Sd;function Sd(t){return t.marginTop=t.marginTop||t.margin,t.marginBottom=t.marginBottom||t.margin,t.marginRight=t.marginRight||t.margin,t.marginLeft=t.marginLeft||t.margin,t}var ft={},pt={},Ee={};Object.defineProperty(Ee,"__esModule",{value:!0});Ee.default=Ad;function Ad(t){var e=["width","height","textMargin","fontSize","margin","marginTop","marginBottom","marginLeft","marginRight"];for(var n in e)e.hasOwnProperty(n)&&(n=e[n],typeof t[n]=="string"&&(t[n]=parseInt(t[n],10)));return typeof t.displayValue=="string"&&(t.displayValue=t.displayValue!="false"),t}var Oe={};Object.defineProperty(Oe,"__esModule",{value:!0});var Id={width:2,height:100,format:"auto",displayValue:!0,fontOptions:"",font:"monospace",text:void 0,textAlign:"center",textPosition:"bottom",textMargin:2,fontSize:20,background:"#ffffff",lineColor:"#000000",margin:10,marginTop:void 0,marginBottom:void 0,marginLeft:void 0,marginRight:void 0,valid:function(){}};Oe.default=Id;Object.defineProperty(pt,"__esModule",{value:!0});var Dd=Ee,kd=fn(Dd),Td=Oe,Nt=fn(Td);function fn(t){return t&&t.__esModule?t:{default:t}}function Pd(t){var e={};for(var n in Nt.default)Nt.default.hasOwnProperty(n)&&(t.hasAttribute("jsbarcode-"+n.toLowerCase())&&(e[n]=t.getAttribute("jsbarcode-"+n.toLowerCase())),t.hasAttribute("data-"+n.toLowerCase())&&(e[n]=t.getAttribute("data-"+n.toLowerCase())));return e.value=t.getAttribute("jsbarcode-value")||t.getAttribute("data-value"),e=(0,kd.default)(e),e}pt.default=Pd;var _t={},ht={},x={};Object.defineProperty(x,"__esModule",{value:!0});x.getTotalWidthOfEncodings=x.calculateEncodingAttributes=x.getBarcodePadding=x.getEncodingHeight=x.getMaximumHeightOfEncodings=void 0;var Rd=Y,Md=Cd(Rd);function Cd(t){return t&&t.__esModule?t:{default:t}}function pn(t,e){return e.height+(e.displayValue&&t.text.length>0?e.fontSize+e.textMargin:0)+e.marginTop+e.marginBottom}function _n(t,e,n){if(n.displayValue&&e<t){if(n.textAlign=="center")return Math.floor((t-e)/2);if(n.textAlign=="left")return 0;if(n.textAlign=="right")return Math.floor(t-e)}return 0}function jd(t,e,n){for(var r=0;r<t.length;r++){var i=t[r],a=(0,Md.default)(e,i.options),o;a.displayValue?o=Bd(i.text,a,n):o=0;var d=i.data.length*a.width;i.width=Math.ceil(Math.max(o,d)),i.height=pn(i,a),i.barcodePadding=_n(o,d,a)}}function Ld(t){for(var e=0,n=0;n<t.length;n++)e+=t[n].width;return e}function Nd(t){for(var e=0,n=0;n<t.length;n++)t[n].height>e&&(e=t[n].height);return e}function Bd(t,e,n){var r;if(n)r=n;else if(typeof document<"u")r=document.createElement("canvas").getContext("2d");else return 0;r.font=e.fontOptions+" "+e.fontSize+"px "+e.font;var i=r.measureText(t);if(!i)return 0;var a=i.width;return a}x.getMaximumHeightOfEncodings=Nd;x.getEncodingHeight=pn;x.getBarcodePadding=_n;x.calculateEncodingAttributes=jd;x.getTotalWidthOfEncodings=Ld;Object.defineProperty(ht,"__esModule",{value:!0});var zd=function(){function t(e,n){for(var r=0;r<n.length;r++){var i=n[r];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(e,i.key,i)}}return function(e,n,r){return n&&t(e.prototype,n),r&&t(e,r),e}}(),qd=Y,Fd=Hd(qd),Ce=x;function Hd(t){return t&&t.__esModule?t:{default:t}}function Gd(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}var Ud=function(){function t(e,n,r){Gd(this,t),this.canvas=e,this.encodings=n,this.options=r}return zd(t,[{key:"render",value:function(){if(!this.canvas.getContext)throw new Error("The browser does not support canvas.");this.prepareCanvas();for(var n=0;n<this.encodings.length;n++){var r=(0,Fd.default)(this.options,this.encodings[n].options);this.drawCanvasBarcode(r,this.encodings[n]),this.drawCanvasText(r,this.encodings[n]),this.moveCanvasDrawing(this.encodings[n])}this.restoreCanvas()}},{key:"prepareCanvas",value:function(){var n=this.canvas.getContext("2d");n.save(),(0,Ce.calculateEncodingAttributes)(this.encodings,this.options,n);var r=(0,Ce.getTotalWidthOfEncodings)(this.encodings),i=(0,Ce.getMaximumHeightOfEncodings)(this.encodings);this.canvas.width=r+this.options.marginLeft+this.options.marginRight,this.canvas.height=i,n.clearRect(0,0,this.canvas.width,this.canvas.height),this.options.background&&(n.fillStyle=this.options.background,n.fillRect(0,0,this.canvas.width,this.canvas.height)),n.translate(this.options.marginLeft,0)}},{key:"drawCanvasBarcode",value:function(n,r){var i=this.canvas.getContext("2d"),a=r.data,o;n.textPosition=="top"?o=n.marginTop+n.fontSize+n.textMargin:o=n.marginTop,i.fillStyle=n.lineColor;for(var d=0;d<a.length;d++){var c=d*n.width+r.barcodePadding;a[d]==="1"?i.fillRect(c,o,n.width,n.height):a[d]&&i.fillRect(c,o,n.width,n.height*a[d])}}},{key:"drawCanvasText",value:function(n,r){var i=this.canvas.getContext("2d"),a=n.fontOptions+" "+n.fontSize+"px "+n.font;if(n.displayValue){var o,d;n.textPosition=="top"?d=n.marginTop+n.fontSize-n.textMargin:d=n.height+n.textMargin+n.marginTop+n.fontSize,i.font=a,n.textAlign=="left"||r.barcodePadding>0?(o=0,i.textAlign="left"):n.textAlign=="right"?(o=r.width-1,i.textAlign="right"):(o=r.width/2,i.textAlign="center"),i.fillText(r.text,o,d)}}},{key:"moveCanvasDrawing",value:function(n){var r=this.canvas.getContext("2d");r.translate(n.width,0)}},{key:"restoreCanvas",value:function(){var n=this.canvas.getContext("2d");n.restore()}}]),t}();ht.default=Ud;var mt={};Object.defineProperty(mt,"__esModule",{value:!0});var Vd=function(){function t(e,n){for(var r=0;r<n.length;r++){var i=n[r];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(e,i.key,i)}}return function(e,n,r){return n&&t(e.prototype,n),r&&t(e,r),e}}(),Xd=Y,Wd=Yd(Xd),je=x;function Yd(t){return t&&t.__esModule?t:{default:t}}function Qd(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}var he="http://www.w3.org/2000/svg",Kd=function(){function t(e,n,r){Qd(this,t),this.svg=e,this.encodings=n,this.options=r,this.document=r.xmlDocument||document}return Vd(t,[{key:"render",value:function(){var n=this.options.marginLeft;this.prepareSVG();for(var r=0;r<this.encodings.length;r++){var i=this.encodings[r],a=(0,Wd.default)(this.options,i.options),o=this.createGroup(n,a.marginTop,this.svg);this.setGroupOptions(o,a),this.drawSvgBarcode(o,a,i),this.drawSVGText(o,a,i),n+=i.width}}},{key:"prepareSVG",value:function(){for(;this.svg.firstChild;)this.svg.removeChild(this.svg.firstChild);(0,je.calculateEncodingAttributes)(this.encodings,this.options);var n=(0,je.getTotalWidthOfEncodings)(this.encodings),r=(0,je.getMaximumHeightOfEncodings)(this.encodings),i=n+this.options.marginLeft+this.options.marginRight;this.setSvgAttributes(i,r),this.options.background&&this.drawRect(0,0,i,r,this.svg).setAttribute("fill",this.options.background)}},{key:"drawSvgBarcode",value:function(n,r,i){var a=i.data,o;r.textPosition=="top"?o=r.fontSize+r.textMargin:o=0;for(var d=0,c=0,u=0;u<a.length;u++)c=u*r.width+i.barcodePadding,a[u]==="1"?d++:d>0&&(this.drawRect(c-r.width*d,o,r.width*d,r.height,n),d=0);d>0&&this.drawRect(c-r.width*(d-1),o,r.width*d,r.height,n)}},{key:"drawSVGText",value:function(n,r,i){var a=this.document.createElementNS(he,"text");if(r.displayValue){var o,d;a.setAttribute("font-family",r.font),a.setAttribute("font-size",r.fontSize),r.fontOptions.includes("bold")&&a.setAttribute("font-weight","bold"),r.fontOptions.includes("italic")&&a.setAttribute("font-style","italic"),r.textPosition=="top"?d=r.fontSize-r.textMargin:d=r.height+r.textMargin+r.fontSize,r.textAlign=="left"||i.barcodePadding>0?(o=0,a.setAttribute("text-anchor","start")):r.textAlign=="right"?(o=i.width-1,a.setAttribute("text-anchor","end")):(o=i.width/2,a.setAttribute("text-anchor","middle")),a.setAttribute("x",o),a.setAttribute("y",d),a.appendChild(this.document.createTextNode(i.text)),n.appendChild(a)}}},{key:"setSvgAttributes",value:function(n,r){var i=this.svg;i.setAttribute("width",n+"px"),i.setAttribute("height",r+"px"),i.setAttribute("x","0px"),i.setAttribute("y","0px"),i.setAttribute("viewBox","0 0 "+n+" "+r),i.setAttribute("xmlns",he),i.setAttribute("version","1.1")}},{key:"createGroup",value:function(n,r,i){var a=this.document.createElementNS(he,"g");return a.setAttribute("transform","translate("+n+", "+r+")"),i.appendChild(a),a}},{key:"setGroupOptions",value:function(n,r){n.setAttribute("fill",r.lineColor)}},{key:"drawRect",value:function(n,r,i,a,o){var d=this.document.createElementNS(he,"rect");return d.setAttribute("x",n),d.setAttribute("y",r),d.setAttribute("width",i),d.setAttribute("height",a),o.appendChild(d),d}}]),t}();mt.default=Kd;var gt={};Object.defineProperty(gt,"__esModule",{value:!0});var Jd=function(){function t(e,n){for(var r=0;r<n.length;r++){var i=n[r];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(e,i.key,i)}}return function(e,n,r){return n&&t(e.prototype,n),r&&t(e,r),e}}();function Zd(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}var el=function(){function t(e,n,r){Zd(this,t),this.object=e,this.encodings=n,this.options=r}return Jd(t,[{key:"render",value:function(){this.object.encodings=this.encodings}}]),t}();gt.default=el;Object.defineProperty(_t,"__esModule",{value:!0});var tl=ht,nl=bt(tl),rl=mt,il=bt(rl),al=gt,ol=bt(al);function bt(t){return t&&t.__esModule?t:{default:t}}_t.default={CanvasRenderer:nl.default,SVGRenderer:il.default,ObjectRenderer:ol.default};var Q={};Object.defineProperty(Q,"__esModule",{value:!0});function yt(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function vt(t,e){if(!t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return e&&(typeof e=="object"||typeof e=="function")?e:t}function xt(t,e){if(typeof e!="function"&&e!==null)throw new TypeError("Super expression must either be null or a function, not "+typeof e);t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,enumerable:!1,writable:!0,configurable:!0}}),e&&(Object.setPrototypeOf?Object.setPrototypeOf(t,e):t.__proto__=e)}var dl=function(t){xt(e,t);function e(n,r){yt(this,e);var i=vt(this,(e.__proto__||Object.getPrototypeOf(e)).call(this));return i.name="InvalidInputException",i.symbology=n,i.input=r,i.message='"'+i.input+'" is not a valid input for '+i.symbology,i}return e}(Error),ll=function(t){xt(e,t);function e(){yt(this,e);var n=vt(this,(e.__proto__||Object.getPrototypeOf(e)).call(this));return n.name="InvalidElementException",n.message="Not supported type to render on",n}return e}(Error),sl=function(t){xt(e,t);function e(){yt(this,e);var n=vt(this,(e.__proto__||Object.getPrototypeOf(e)).call(this));return n.name="NoElementException",n.message="No element to render on.",n}return e}(Error);Q.InvalidInputException=dl;Q.InvalidElementException=ll;Q.NoElementException=sl;Object.defineProperty(ft,"__esModule",{value:!0});var cl=typeof Symbol=="function"&&typeof Symbol.iterator=="symbol"?function(t){return typeof t}:function(t){return t&&typeof Symbol=="function"&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},ul=pt,Ge=hn(ul),fl=_t,ne=hn(fl),pl=Q;function hn(t){return t&&t.__esModule?t:{default:t}}function wt(t){if(typeof t=="string")return _l(t);if(Array.isArray(t)){for(var e=[],n=0;n<t.length;n++)e.push(wt(t[n]));return e}else{if(typeof HTMLCanvasElement<"u"&&t instanceof HTMLImageElement)return hl(t);if(t&&t.nodeName&&t.nodeName.toLowerCase()==="svg"||typeof SVGElement<"u"&&t instanceof SVGElement)return{element:t,options:(0,Ge.default)(t),renderer:ne.default.SVGRenderer};if(typeof HTMLCanvasElement<"u"&&t instanceof HTMLCanvasElement)return{element:t,options:(0,Ge.default)(t),renderer:ne.default.CanvasRenderer};if(t&&t.getContext)return{element:t,renderer:ne.default.CanvasRenderer};if(t&&(typeof t>"u"?"undefined":cl(t))==="object"&&!t.nodeName)return{element:t,renderer:ne.default.ObjectRenderer};throw new pl.InvalidElementException}}function _l(t){var e=document.querySelectorAll(t);if(e.length!==0){for(var n=[],r=0;r<e.length;r++)n.push(wt(e[r]));return n}}function hl(t){var e=document.createElement("canvas");return{element:e,options:(0,Ge.default)(t),renderer:ne.default.CanvasRenderer,afterRender:function(){t.setAttribute("src",e.toDataURL())}}}ft.default=wt;var $t={};Object.defineProperty($t,"__esModule",{value:!0});var ml=function(){function t(e,n){for(var r=0;r<n.length;r++){var i=n[r];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(e,i.key,i)}}return function(e,n,r){return n&&t(e.prototype,n),r&&t(e,r),e}}();function gl(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}var bl=function(){function t(e){gl(this,t),this.api=e}return ml(t,[{key:"handleCatch",value:function(n){if(n.name==="InvalidInputException")if(this.api._options.valid!==this.api._defaults.valid)this.api._options.valid(!1);else throw n.message;else throw n;this.api.render=function(){}}},{key:"wrapBarcodeCall",value:function(n){try{var r=n.apply(void 0,arguments);return this.api._options.valid(!0),r}catch(i){return this.handleCatch(i),this.api}}}]),t}();$t.default=bl;var yl=Ve,C=T(yl),vl=Y,le=T(vl),xl=ct,mn=T(xl),wl=ut,Bt=T(wl),$l=ft,El=T($l),Ol=Ee,Sl=T(Ol),Al=$t,Il=T(Al),gn=Q,Dl=Oe,bn=T(Dl);function T(t){return t&&t.__esModule?t:{default:t}}var S=function(){},Se=function(e,n,r){var i=new S;if(typeof e>"u")throw Error("No element to render on was provided.");return i._renderProperties=(0,El.default)(e),i._encodings=[],i._options=bn.default,i._errorHandler=new Il.default(i),typeof n<"u"&&(r=r||{},r.format||(r.format=vn()),i.options(r)[r.format](n,r).render()),i};Se.getModule=function(t){return C.default[t]};for(var zt in C.default)C.default.hasOwnProperty(zt)&&kl(C.default,zt);function kl(t,e){S.prototype[e]=S.prototype[e.toUpperCase()]=S.prototype[e.toLowerCase()]=function(n,r){var i=this;return i._errorHandler.wrapBarcodeCall(function(){r.text=typeof r.text>"u"?void 0:""+r.text;var a=(0,le.default)(i._options,r);a=(0,Sl.default)(a);var o=t[e],d=yn(n,o,a);return i._encodings.push(d),i})}}function yn(t,e,n){t=""+t;var r=new e(t,n);if(!r.valid())throw new gn.InvalidInputException(r.constructor.name,t);var i=r.encode();i=(0,mn.default)(i);for(var a=0;a<i.length;a++)i[a].options=(0,le.default)(n,i[a].options);return i}function vn(){return C.default.CODE128?"CODE128":Object.keys(C.default)[0]}S.prototype.options=function(t){return this._options=(0,le.default)(this._options,t),this};S.prototype.blank=function(t){var e=new Array(t+1).join("0");return this._encodings.push({data:e}),this};S.prototype.init=function(){if(this._renderProperties){Array.isArray(this._renderProperties)||(this._renderProperties=[this._renderProperties]);var t;for(var e in this._renderProperties){t=this._renderProperties[e];var n=(0,le.default)(this._options,t.options);n.format=="auto"&&(n.format=vn()),this._errorHandler.wrapBarcodeCall(function(){var r=n.value,i=C.default[n.format.toUpperCase()],a=yn(r,i,n);Ue(t,a,n)})}}};S.prototype.render=function(){if(!this._renderProperties)throw new gn.NoElementException;if(Array.isArray(this._renderProperties))for(var t=0;t<this._renderProperties.length;t++)Ue(this._renderProperties[t],this._encodings,this._options);else Ue(this._renderProperties,this._encodings,this._options);return this};S.prototype._defaults=bn.default;function Ue(t,e,n){e=(0,mn.default)(e);for(var r=0;r<e.length;r++)e[r].options=(0,le.default)(n,e[r].options),(0,Bt.default)(e[r].options);(0,Bt.default)(n);var i=t.renderer,a=new i(t.element,e,n);a.render(),t.afterRender&&t.afterRender()}typeof window<"u"&&(window.JsBarcode=Se);typeof jQuery<"u"&&(jQuery.fn.JsBarcode=function(t,e){var n=[];return jQuery(this).each(function(){n.push(this)}),Se(n,t,e)});var Tl=Se;const Pl=Sn(Tl);function D(t,e){const{width:n=2,height:r=50,displayValue:i=!0,fontSize:a=12,margin:o=6}=e||{},d=document.createElement("canvas");return Pl(d,t,{format:"CODE128",width:n,height:r,displayValue:i,fontSize:a,margin:o,background:"#ffffff",lineColor:"#000000"}),d.toDataURL("image/png")}async function Rl(t,e=96){return An.toDataURL(t,{width:e,margin:1})}function R(t){return String(t??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}const Le="50.8mm",qt="25.4mm";function Ml(){return`
    * { box-sizing: border-box; }
    @page { size: ${Le} ${qt}; margin: 0; }
    html, body { margin: 0; padding: 0; color: #000; background: #fff;
      font-family: Arial, Helvetica, sans-serif; }
    .label {
      width: ${Le}; height: ${qt};
      padding: 1mm 1.75mm; overflow: hidden;
      page-break-after: always; break-after: page;
      display: flex; flex-direction: column;
    }
    .label:last-child { page-break-after: auto; break-after: auto; }
    .row { display: flex; justify-content: space-between; align-items: baseline; }
    .name { font-size: 10px; font-weight: bold; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis; }
    .meta { font-size: 9px; font-weight: bold; margin-left: 2mm; white-space: nowrap; }
    .allergy { font-size: 8px; font-weight: bold; color: #000;
      border: 1px solid #000; padding: 0 1mm; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis; }
    .barcode { text-align: center; margin: 0.5mm 0; }
    .barcode img { max-width: 100%; height: 9mm; object-fit: contain; }
    .foot { display: flex; justify-content: space-between; font-size: 8px; font-weight: bold; }
    .with-qr { display: flex; gap: 1mm; }
    .with-qr .body { flex: 1; min-width: 0; }
    .with-qr .qr img { width: 12mm; height: 12mm; }
    @media screen {
      body { padding: 12px; background: #f3f4f6; }
      .label { margin-bottom: 10px; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.12); }
    }
    @media print {
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      html, body { width: ${Le} !important; margin: 0 !important; padding: 0 !important; }
      .label { page-break-inside: avoid !important; break-inside: avoid !important; }
    }
  `}function Cl(t,e,n){const r=[t.gender?.[0]?.toUpperCase(),t.age?`${t.age}Y`:"",t.bloodGroup].filter(Boolean).join(" "),i=(t.allergies??[]).filter(Boolean),a=`
    <div class="body">
      <div class="row">
        <span class="name">${R(t.patientName)}</span>
        ${r?`<span class="meta">${R(r)}</span>`:""}
      </div>
      ${i.length?`<div class="allergy">⚠ ${R(i.join(", "))}</div>`:""}
      <div class="barcode"><img src="${e}" alt="${R(t.admissionNumber)}" /></div>
      <div class="foot">
        <span>${R(t.wardBed??"")}</span>
        <span>${R(t.admittedOn??"")}</span>
      </div>
    </div>`;return`
    <section class="label${n?" with-qr":""}">
      ${a}
      ${n?`<div class="qr"><img src="${n}" alt="QR" /></div>`:""}
    </section>`}async function jl(t,e){const n=e?.copies??2,r=D(t.admissionNumber,{height:34,fontSize:10,margin:2}),i=e?.includeQr&&t.chartUrl?await Rl(t.chartUrl):void 0,a=Array.from({length:n},()=>Cl(t,r,i)).join(`
`);return`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${R(e?.title??`Labels ${t.admissionNumber}`)}</title>
    <style>${Ml()}</style>
  </head>
  <body>${a}</body>
</html>`}async function xs(t,e){const n=await jl(t,e),r=document.createElement("iframe");r.style.position="fixed",r.style.right="-10000px",document.body.appendChild(r);const i=r.contentWindow?.document;i&&(i.open(),i.write(n),i.close(),r.contentWindow?.focus(),setTimeout(()=>{r.contentWindow?.print(),setTimeout(()=>document.body.removeChild(r),2e3)},250))}const Ft=t=>t?{recorded_at:t}:{},Ne={async listVitals(t,e=50){const{data:n,error:r}=await s.from("ipd_vitals").select("*, recorder:profiles!ipd_vitals_recorded_by_fkey(id, name)").eq("admission_id",t).order("recorded_at",{ascending:!1}).limit(e);if(r)throw r;return n},async recordVitals(t){const{data:e,error:n}=await s.from("ipd_vitals").insert({clinic_id:t.clinicId,admission_id:t.admissionId,recorded_by:t.userId??null,...Ft(t.recordedAt),...t.vitals}).select().single();if(n)throw n;return e},async listNotes(t,e=100){const{data:n,error:r}=await s.from("ipd_nursing_notes").select("*, author:profiles!ipd_nursing_notes_created_by_fkey(id, name)").eq("admission_id",t).order("created_at",{ascending:!1}).limit(e);if(r)throw r;return n},async addNote(t){const{data:e,error:n}=await s.from("ipd_nursing_notes").insert({clinic_id:t.clinicId,admission_id:t.admissionId,note_type:t.noteType,note:t.note,created_by:t.userId??null,...t.observedAt?{created_at:t.observedAt}:{}}).select().single();if(n)throw n;return e},async listTasks(t,e=400){const{data:n,error:r}=await s.from("ipd_nursing_tasks").select("*").eq("admission_id",t).order("due_at",{ascending:!1,nullsFirst:!1}).limit(e);if(r)throw r;const i=o=>o.status==="pending"?0:1,a=o=>o.due_at?new Date(o.due_at).getTime():0;return n.sort((o,d)=>i(o)!==i(d)?i(o)-i(d):i(o)===0?a(o)-a(d):a(d)-a(o))},async addTask(t){const{data:e,error:n}=await s.from("ipd_nursing_tasks").insert({clinic_id:t.clinicId,admission_id:t.admissionId,task:t.task,due_at:t.dueAt??null,recurrence:t.recurrence??null,created_by:t.userId??null}).select().single();if(n)throw n;return e},async setTaskStatus(t,e,n){const{error:r}=await s.from("ipd_nursing_tasks").update({status:e,done_by:e==="done"?n??null:null,done_at:e==="done"?new Date().toISOString():null}).eq("id",t);if(r)throw r},async listIO(t,e=100){const{data:n,error:r}=await s.from("ipd_intake_output").select("*, recorder:profiles!ipd_intake_output_recorded_by_fkey(id, name)").eq("admission_id",t).order("recorded_at",{ascending:!1}).limit(e);if(r)throw r;return n},async recordIO(t){const{data:e,error:n}=await s.from("ipd_intake_output").insert({clinic_id:t.clinicId,admission_id:t.admissionId,io_type:t.ioType,route:t.route,volume_ml:t.volumeMl,notes:t.notes??null,recorded_by:t.userId??null,...Ft(t.recordedAt)}).select().single();if(n)throw n;return e},async amendChartRow(t){const{error:e}=await s.rpc("amend_ipd_chart_row",{p_table:t.table,p_id:t.id,p_patch:t.patch,p_reason:t.reason});if(e)throw new Error(e.message)},async deleteChartRow(t){const{error:e}=await s.rpc("delete_ipd_chart_row",{p_table:t.table,p_id:t.id,p_reason:t.reason});if(e)throw new Error(e.message)},async listAmendments(t,e=200){const{data:n,error:r}=await s.from("ipd_chart_amendments").select("*, amender:profiles!ipd_chart_amendments_amended_by_fkey(id, name)").eq("admission_id",t).order("amended_at",{ascending:!1}).limit(e);if(r)throw r;return n}},Ht=t=>[t.subjective,t.objective,t.assessment,t.plan,t.advice].some(e=>e&&e.trim()),Ll={async list(t){const{data:e,error:n}=await s.from("ipd_treatment_plans").select("*, doctor:profiles!ipd_treatment_plans_doctor_id_fkey(id, name)").eq("admission_id",t).order("plan_date",{ascending:!1}).order("recorded_at",{ascending:!1});if(n)throw n;return e},async latest(t){const{data:e,error:n}=await s.from("ipd_treatment_plans").select("*").eq("admission_id",t).order("plan_date",{ascending:!1}).order("recorded_at",{ascending:!1}).limit(1).maybeSingle();if(n)throw n;return e??null},async create(t){const{input:e}=t;if(!Ht(e))throw new Error("Write at least one part of the plan");const{data:n,error:r}=await s.from("ipd_treatment_plans").insert({clinic_id:t.clinicId,admission_id:t.admissionId,plan_date:e.planDate??new Date().toISOString().slice(0,10),doctor_id:e.doctorId??t.userId??null,subjective:e.subjective??null,objective:e.objective??null,assessment:e.assessment??null,plan:e.plan??null,advice:e.advice??null,voice_transcript:e.voiceTranscript??null,created_by:t.userId??null}).select().single();if(r)throw r;return n},async appendDictation(t){const{input:e,transcript:n}=t;if(!Ht(e)&&!n?.trim())throw new Error("Nothing new to add to this entry");const{data:r,error:i}=await s.from("ipd_treatment_plans").select("*").eq("id",t.planId).single();if(i)throw i;const a=r,o=new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:!1}),d=(h,b)=>{const A=b?.trim();return A?h?.trim()?`${h.trim()}
[${o}] ${A}`:A:h},{data:c,error:u}=await s.from("ipd_treatment_plans").update({subjective:d(a.subjective,e.subjective),objective:d(a.objective,e.objective),assessment:d(a.assessment,e.assessment),plan:d(a.plan,e.plan),advice:d(a.advice,e.advice),voice_transcript:d(a.voice_transcript,n),updated_at:new Date().toISOString()}).eq("id",t.planId).select().single();if(u)throw u;return c},async update(t,e){const{error:n}=await s.from("ipd_treatment_plans").update({plan_date:e.planDate,subjective:e.subjective??null,objective:e.objective??null,assessment:e.assessment??null,plan:e.plan??null,advice:e.advice??null,updated_at:new Date().toISOString()}).eq("id",t);if(n)throw n},async remove(t){const{error:e}=await s.from("ipd_treatment_plans").delete().eq("id",t);if(e)throw e},async listConsultations(t){const{data:e,error:n}=await s.from("ipd_consultations").select("*, doctor:profiles!ipd_consultations_doctor_id_fkey(id, name)").eq("admission_id",t).order("requested_at",{ascending:!1});if(n)throw n;return e},async requestConsultation(t){if(!t.reason.trim())throw new Error("Reason for consultation is required");const{data:e,error:n}=await s.from("ipd_consultations").insert({clinic_id:t.clinicId,admission_id:t.admissionId,treatment_plan_id:t.treatmentPlanId??null,specialty:t.specialty??null,doctor_id:t.doctorId??null,external_doctor_name:t.externalDoctorName??null,reason:t.reason.trim(),urgency:t.urgency??"routine",requested_by:t.userId??null}).select().single();if(n)throw n;return e},async getConsultationService(t){const{data:e}=await s.from("services_master").select("id, name, base_price").eq("clinic_id",t).eq("service_code","CONS-CROSS").eq("is_active",!0).maybeSingle();if(e)return e;const{data:n}=await s.from("services_master").select("id, name, base_price").eq("clinic_id",t).eq("service_type","consultation").eq("is_active",!0).order("base_price",{ascending:!1}).limit(1).maybeSingle();return n??null},async recordOpinion(t){let e=null;t.billing&&t.billing.unitRate>=0&&(e=(await Dn.postCharge({clinicId:t.billing.clinicId,admissionId:t.billing.admissionId,serviceId:t.billing.serviceId,quantity:1,unitRate:t.billing.unitRate,source:"order",sourceRef:t.consultationId,description:t.billing.description,orderingDoctorId:t.userId,performingDoctorId:t.doctorId??void 0,userId:t.userId})).id);const{error:n}=await s.from("ipd_consultations").update({opinion:t.opinion,status:"seen",seen_by:t.userId??null,seen_at:new Date().toISOString(),...t.doctorId?{doctor_id:t.doctorId}:{},...e?{charge_posting_id:e}:{},updated_at:new Date().toISOString()}).eq("id",t.consultationId);if(n)throw n},async cancelConsultation(t,e){const{error:n}=await s.from("ipd_consultations").update({status:"cancelled",cancelled_reason:e,updated_at:new Date().toISOString()}).eq("id",t);if(n)throw n}},Nl=[{key:"early_morning",label:"Early morning",time:"06:00"},{key:"breakfast",label:"Breakfast",time:"08:00"},{key:"mid_morning",label:"Mid morning",time:"11:00"},{key:"lunch",label:"Lunch",time:"13:00"},{key:"evening",label:"Evening",time:"16:30"},{key:"dinner",label:"Dinner",time:"20:00"},{key:"bedtime",label:"Bedtime",time:"22:00"}],Bl=[{key:"normal",label:"Normal / full diet"},{key:"soft",label:"Soft diet"},{key:"semi_solid",label:"Semi-solid"},{key:"liquid",label:"Liquid diet"},{key:"diabetic",label:"Diabetic diet"},{key:"renal",label:"Renal diet"},{key:"cardiac",label:"Cardiac diet"},{key:"low_salt",label:"Salt restricted"},{key:"high_protein",label:"High protein"},{key:"low_fat",label:"Low fat"},{key:"bland",label:"Bland diet"},{key:"pediatric",label:"Pediatric"},{key:"npo",label:"NPO — nil by mouth"},{key:"other",label:"Other"}],ws=[{key:"oral",label:"Oral"},{key:"ryles_tube",label:"Ryle's tube"},{key:"peg",label:"PEG"},{key:"npo",label:"NPO"},{key:"tpn",label:"TPN (parenteral)"}],$s={async listOrders(t){const{data:e,error:n}=await s.from("ipd_diet_orders").select("*").eq("admission_id",t).order("created_at",{ascending:!1});if(n)throw n;return e},async activeOrder(t){const{data:e,error:n}=await s.from("ipd_diet_orders").select("*").eq("admission_id",t).eq("status","active").order("created_at",{ascending:!1}).limit(1).maybeSingle();if(n)throw n;return e??null},async setOrder(t){const{input:e}=t;await s.from("ipd_diet_orders").update({status:"stopped",end_date:new Date().toISOString().slice(0,10),stopped_reason:"Superseded by a new diet order",updated_at:new Date().toISOString()}).eq("admission_id",t.admissionId).eq("status","active");const{data:n,error:r}=await s.from("ipd_diet_orders").insert({clinic_id:t.clinicId,admission_id:t.admissionId,treatment_plan_id:e.treatmentPlanId??null,diet_type:e.dietType,route:e.route,calories_kcal:e.caloriesKcal??null,protein_g:e.proteinG??null,fluid_restriction_ml:e.fluidRestrictionMl??null,special_instructions:e.specialInstructions??null,restrictions:e.restrictions??null,start_date:e.startDate??new Date().toISOString().slice(0,10),ordered_by:t.userId??null}).select().single();if(r)throw r;return n},async stopOrder(t,e){const{error:n}=await s.from("ipd_diet_orders").update({status:"stopped",end_date:new Date().toISOString().slice(0,10),stopped_reason:e,updated_at:new Date().toISOString()}).eq("id",t);if(n)throw n},async listEntries(t,e=7){const n=new Date;n.setDate(n.getDate()-(e-1));const{data:r,error:i}=await s.from("ipd_diet_chart_entries").select("*").eq("admission_id",t).gte("entry_date",n.toISOString().slice(0,10)).order("entry_date",{ascending:!1});if(i)throw i;return r},async recordMeal(t){const e=t.status==="served",{data:n,error:r}=await s.from("ipd_diet_chart_entries").upsert({clinic_id:t.clinicId,admission_id:t.admissionId,diet_order_id:t.dietOrderId??null,entry_date:t.entryDate,meal:t.meal,items:t.items??null,status:t.status,intake_percent:t.intakePercent??null,notes:t.notes??null,served_by:e?t.userId??null:null,served_at:e?new Date().toISOString():null,created_by:t.userId??null},{onConflict:"admission_id,entry_date,meal"}).select().single();if(r)throw r;return n}},xn=[{key:"initial_assessment",label:"Initial Doctor Assessment"},{key:"admission_sheet",label:"Admission Sheet"},{key:"case_sheet",label:"IPD Case Sheet (Orders)"},{key:"nursing_chart",label:"Nursing Sheet"},{key:"ot_note",label:"OT Note (Report of Surgery)"},{key:"discharge_summary",label:"Discharge Summary"},{key:"discharge_medication",label:"Discharge Medication"},{key:"consent",label:"Consent Form"},{key:"death_summary",label:"Death Summary"},{key:"dama_form",label:"DAMA Form"},{key:"referral_letter",label:"Referral Letter"},{key:"estimate",label:"Estimate"}],wn=t=>xn.find(e=>e.key===t)?.label??t.replace(/_/g," "),Es=[{key:"ipd_documents",label:"Any documents user (front desk / ward)"},{key:"ipd_documents_nursing",label:"Nursing staff & doctors"},{key:"ipd_documents_clinical",label:"Treating doctor only"}],zl={initial_assessment:"ipd_documents_clinical",admission_sheet:"ipd_documents",case_sheet:"ipd_documents_clinical",nursing_chart:"ipd_documents_nursing",ot_note:"ipd_documents_clinical",discharge_summary:"ipd_documents_clinical",discharge_medication:"ipd_documents_clinical",consent:"ipd_documents",death_summary:"ipd_documents_clinical",dama_form:"ipd_documents",referral_letter:"ipd_documents_clinical",estimate:"ipd_documents"},ql=(t,e)=>e?.[t]??zl[t]??"ipd_documents",Os=(t,e,n)=>{const r=ql(t,n);return e(r)||r==="ipd_documents_nursing"&&e("ipd_documents_clinical")},Ss=t=>{const e=t?.message??"Something went wrong";return/row-level security/i.test(e)?"You are not allowed to write this document type — the treating doctor signs assessments, case sheets, OT notes, discharge/death summaries and referrals. Masters → Document Templates shows who may write each type.":e},Be=[{key:"patient.name",label:"Patient name"},{key:"patient.uhid",label:"UHID"},{key:"patient.age",label:"Age"},{key:"patient.gender",label:"Gender"},{key:"patient.age_sex",label:"Age / Sex"},{key:"patient.phone",label:"Phone"},{key:"patient.blood_group",label:"Blood group"},{key:"patient.allergies",label:"Allergies"},{key:"admission.number",label:"Admission no"},{key:"admission.date",label:"Admission date"},{key:"admission.datetime",label:"Admission date & time"},{key:"admission.bed",label:"Ward / bed"},{key:"admission.attendant",label:"Attendant (name & phone)"},{key:"today",label:"Today’s date"},{key:"now",label:"Date & time now"},{key:"vitals.chart",label:"Vitals chart (all recorded rounds)"},{key:"admission.diagnosis",label:"Diagnosis"},{key:"admission.icd_codes",label:"ICD-10 codes"},{key:"admission.reason",label:"Reason for admission"},{key:"admission.los",label:"Length of stay (days)"},{key:"doctor.name",label:"Consultant"},{key:"discharge.date",label:"Discharge date"},{key:"discharge.type",label:"Discharge type"},{key:"vitals.latest",label:"Latest vitals"},{key:"medications.discharge",label:"Discharge medications (table)"},{key:"medications.course",label:"Medications during stay (list)"},{key:"investigations.list",label:"Investigations (lab/imaging)"},{key:"reports.list",label:"Filed reports (pathology/radiology impressions)"},{key:"consultations.list",label:"Cross consultations & opinions"},{key:"diet.current",label:"Diet advice (current diet order)"},{key:"io.chart",label:"Intake / output chart (all timed entries, with balance)"},{key:"medications.administered",label:"Medication administration record (eMAR — timed, with nurse)"},{key:"notes.nursing",label:"Nursing observations (timed, with nurse)"},{key:"tasks.done",label:"Nursing care given (completed tasks, timed)"},{key:"plan.today",label:"Today’s treatment plan (S/O/A/P entries with times)"},{key:"notes.course",label:"Hospital course (treatment plan + round notes)"},{key:"narrative.course",label:"Hospital course — AI narrative (falls back to round notes)"},{key:"narrative.advice",label:"Advice & follow-up — AI narrative"},{key:"narrative.condition",label:"Condition at discharge — AI narrative"}],F=6,Fl=`
<h2 style="text-align:center;margin:0 0 4px">DISCHARGE SUMMARY</h2>
<table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:12px">
  <tr>
    <td style="padding:2px 4px"><b>Patient:</b> {{patient.name}} ({{patient.age}}y / {{patient.gender}})</td>
    <td style="padding:2px 4px"><b>Admission No:</b> {{admission.number}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Admitted:</b> {{admission.date}}</td>
    <td style="padding:2px 4px"><b>Discharged:</b> {{discharge.date}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Consultant:</b> Dr. {{doctor.name}}</td>
    <td style="padding:2px 4px"><b>Ward/Bed:</b> {{admission.bed}} · Stay: {{admission.los}} day(s)</td>
  </tr>
</table>

<h3>Diagnosis</h3>
<p>{{admission.diagnosis}}</p>

<h3>Presenting Complaints / Reason for Admission</h3>
<p>{{admission.reason}}</p>

<h3>Hospital Course</h3>
{{narrative.course}}

<h3>Investigations</h3>
{{investigations.list}}

<h3>Reports</h3>
{{reports.list}}

<h3>Cross Consultations</h3>
{{consultations.list}}

<h3>Vitals at Discharge</h3>
<p>{{vitals.latest}}</p>

<h3>Treatment Given</h3>
{{medications.course}}

<h3>Medications on Discharge</h3>
{{medications.discharge}}

<h3>Diet Advice</h3>
<p>{{diet.current}}</p>

<h3>Advice & Follow-up</h3>
{{narrative.advice}}

<h3>Condition at Discharge</h3>
<p>{{narrative.condition}}</p>

<br/><br/>
<table style="width:100%;font-size:13px">
  <tr>
    <td><b>Dr. {{doctor.name}}</b><br/>Consultant</td>
    <td style="text-align:right">Date: {{discharge.date}}</td>
  </tr>
</table>
`,Hl={initial_assessment:["Present Complaints","History of Present Illness","Past History","Family History","Personal History","Physical Examination","Systemic Examination","Local Examination","Provisional Diagnosis","Treatment Plan"],case_sheet:["Details","Management"],nursing_chart:["Vitals","Intake & Output","Nursing Observations","Care Given"],discharge_medication:["Diagnosis","Medications on Discharge","Diet Advice","Advice & Follow-up"],admission_sheet:["Presenting Complaints","History of Present Illness","Past History","Personal & Family History","General Examination","Systemic Examination","Provisional Diagnosis","Plan of Management"],consent:["Procedure / Treatment Proposed","Explanation Given","Risks & Complications Explained","Alternatives Discussed","Consent Declaration"],ot_note:["Pre-operative Diagnosis","Procedure Performed","Surgeon & Team","Anaesthesia","Operative Findings","Procedure in Detail","Specimen / Implants","Blood Loss & Fluids","Post-operative Instructions"],death_summary:["Diagnosis","Hospital Course","Investigations","Treatment Given","Events Leading to Death","Cause of Death","Time of Death"],dama_form:["Diagnosis","Condition at Time of Leaving","Advice Given","Risks Explained","Reason Stated by Patient / Relative","Declaration"],referral_letter:["Reason for Referral","Clinical Summary","Investigations","Treatment Given So Far","Condition at Referral","Advice / Request"],estimate:["Provisional Diagnosis","Proposed Treatment / Procedure","Estimated Length of Stay","Estimated Cost Breakup","Notes & Disclaimer"]},Gl=`<table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:12px">
  <tr>
    <td style="padding:2px 4px"><b>Patient:</b> {{patient.name}} ({{patient.age}}y / {{patient.gender}})</td>
    <td style="padding:2px 4px"><b>UHID:</b> {{patient.uhid}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Admitted:</b> {{admission.date}}</td>
    <td style="padding:2px 4px"><b>Admission No:</b> {{admission.number}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Consultant:</b> Dr. {{doctor.name}}</td>
    <td style="padding:2px 4px"><b>Ward/Bed:</b> {{admission.bed}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px" colspan="2"><b>Diagnosis:</b> {{admission.diagnosis}}</td>
  </tr>
</table>`,Ul=`<table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:10px">
  <tr>
    <td style="padding:2px 4px"><b>Name of Patient:</b> {{patient.name}}</td>
    <td style="padding:2px 4px"><b>Age / Sex:</b> {{patient.age_sex}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Room:</b> {{admission.bed}}</td>
    <td style="padding:2px 4px"><b>UHID:</b> {{patient.uhid}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>IPD No:</b> {{admission.number}}</td>
    <td style="padding:2px 4px"><b>Consultant:</b> Dr. {{doctor.name}}</td>
  </tr>
</table>`,Ae=t=>`<p style="margin:0;font-size:13px"><b>Date:</b> {{today}}</p>
<h2 style="text-align:center;margin:2px 0 8px">${t}</h2>
${Ul}`,$n=`<table style="width:100%;font-size:13px;margin-top:18px">
  <tr>
    <td><b>Dr. {{doctor.name}}</b><br/>Consultant</td>
    <td style="text-align:right">Sign: ____________________</td>
  </tr>
</table>`,Vl=`${Ae("INITIAL DOCTOR ASSESSMENT")}
<h3>Present Complaints</h3>
<p>{{admission.reason}}</p>

<h3>History of Present Illness</h3>
<p></p>

<h3>Past History</h3>
<p></p>

<h3>Family History</h3>
<p></p>

<h3>Personal History</h3>
<table style="width:100%;font-size:13px;border-collapse:collapse">
  <tr>
    <td style="padding:2px 4px"><b>Diet:</b> </td>
    <td style="padding:2px 4px"><b>Appetite:</b> </td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Bowel / Bladder:</b> </td>
    <td style="padding:2px 4px"><b>Sleep:</b> </td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Addiction:</b> </td>
    <td style="padding:2px 4px"><b>Current Medication:</b> </td>
  </tr>
  <tr>
    <td style="padding:2px 4px" colspan="2"><b>Allergy:</b> {{patient.allergies}}</td>
  </tr>
</table>

<h3>Physical Examination</h3>
<p><b>Vitals:</b> {{vitals.latest}}</p>
<p><b>Sensorium:</b> Conscious &nbsp;·&nbsp; <b>Pallor:</b> &nbsp;·&nbsp; <b>Icterus:</b> &nbsp;·&nbsp;
<b>Cyanosis:</b> &nbsp;·&nbsp; <b>Oedema:</b> &nbsp;·&nbsp; <b>Lymphadenopathy:</b> </p>

<h3>Systemic Examination</h3>
<p><b>P/A:</b> &nbsp;·&nbsp; <b>R/S:</b> &nbsp;·&nbsp; <b>CVS:</b> &nbsp;·&nbsp; <b>CNS:</b> </p>

<h3>Local Examination</h3>
<ul>
  <li><b>Inspection:</b> </li>
  <li><b>Palpation:</b> </li>
  <li><b>Special examination (P/R, proctoscopy, probing, etc.):</b> </li>
</ul>

<h3>Investigations</h3>
{{investigations.list}}

<h3>Provisional Diagnosis</h3>
<p>{{admission.diagnosis}}</p>

<h3>Treatment Plan</h3>
<p></p>
${$n}
`,ze=(t,e)=>`<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:10px">
  <tr>
    <td style="border:1px solid #cbd5e1;padding:4px 6px;background:#f1f5f9;width:50%">
      <b>Date &amp; Time of Order:</b> ____________________
    </td>
    <td style="border:1px solid #cbd5e1;padding:4px 6px;background:#f1f5f9">
      Seen by: Dr. ____________________
    </td>
  </tr>
  <tr>
    <td style="border:1px solid #cbd5e1;padding:4px 6px;background:#f8fafc"><b>Details</b></td>
    <td style="border:1px solid #cbd5e1;padding:4px 6px;background:#f8fafc"><b>Management</b></td>
  </tr>
  <tr>
    <td style="border:1px solid #cbd5e1;padding:6px;vertical-align:top;height:110px">${t}</td>
    <td style="border:1px solid #cbd5e1;padding:6px;vertical-align:top">${e}</td>
  </tr>
  <tr>
    <td style="border:1px solid #cbd5e1;padding:4px 6px" colspan="2">Sign: ____________________</td>
  </tr>
</table>`,Xl=`${Ae("IPD CASE SHEET")}
${ze(`<p><b>S/B</b> Dr. {{doctor.name}}</p><p><b>Vitals:</b> {{vitals.latest}}</p>
    <p><b>C/O:</b> {{admission.reason}}</p><p><b>Diagnosis:</b> {{admission.diagnosis}}</p>`,"<p><b>Plan of care today:</b></p>{{plan.today}}<p>Further orders:</p><ul><li></li><li></li></ul>")}
${ze("<p></p>","<p></p>")}
${ze("<p></p>","<p></p>")}
`,Gt=(t,e=3)=>Array.from({length:e}).map(()=>`<tr>${Array.from({length:t}).map((n,r)=>`<td style="border:1px solid #cbd5e1${r===0?";padding:8px 5px":""}"></td>`).join("")}</tr>`).join(""),Wl=`${Ae("NURSING SHEET")}
<h3>Vitals</h3>
{{vitals.chart}}
<table style="width:100%;border-collapse:collapse;font-size:12px">${Gt(8)}</table>

<h3>Intake &amp; Output</h3>
{{io.chart}}
<table style="width:100%;border-collapse:collapse;font-size:12px">${Gt(6)}</table>

<h3>Diet</h3>
<p>{{diet.current}}</p>

<h3>Medication Administered</h3>
{{medications.administered}}

<h3>Nursing Observations</h3>
{{notes.nursing}}
<p></p>

<h3>Care Given</h3>
{{tasks.done}}
<p></p>

<table style="width:100%;font-size:13px;margin-top:18px">
  <tr>
    <td>Staff Nurse: ____________________</td>
    <td style="text-align:right">Sign: ____________________</td>
  </tr>
</table>
`,Yl=`${Ae("REPORT OF SURGERY")}
<table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:10px">
  <tr>
    <td style="padding:2px 4px"><b>Date &amp; time of surgery:</b> {{now}}</td>
    <td style="padding:2px 4px"><b>Surgeon:</b> Dr. {{doctor.name}}</td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Assistant(s):</b> </td>
    <td style="padding:2px 4px"><b>Anaesthetist:</b> </td>
  </tr>
  <tr>
    <td style="padding:2px 4px"><b>Anaesthesia:</b> </td>
    <td style="padding:2px 4px"><b>Position:</b> </td>
  </tr>
</table>

<h3>Pre-operative Diagnosis</h3>
<p>{{admission.diagnosis}}</p>

<h3>Post-operative Diagnosis</h3>
<p></p>

<h3>Procedure Performed</h3>
<p></p>

<h3>Operative Findings</h3>
<p></p>

<h3>Procedure in Detail</h3>
<p></p>

<h3>Specimen / Implants</h3>
<p></p>

<h3>Blood Loss &amp; Fluids</h3>
<p></p>

<h3>Post-operative Instructions</h3>
<ul><li></li><li></li><li></li></ul>
${$n}
`,Ql={discharge_summary:Fl,initial_assessment:Vl,case_sheet:Xl,nursing_chart:Wl,ot_note:Yl};function Kl(t){const e={Diagnosis:"<p>{{admission.diagnosis}}</p>","Provisional Diagnosis":"<p>{{admission.diagnosis}}</p>","Pre-operative Diagnosis":"<p>{{admission.diagnosis}}</p>","Presenting Complaints":"<p>{{admission.reason}}</p>","Reason for Referral":"<p>{{admission.reason}}</p>","Medications on Discharge":"{{medications.discharge}}","Treatment Given":"{{medications.course}}","Treatment Given So Far":"{{medications.course}}",Investigations:"{{investigations.list}}","Hospital Course":"{{notes.course}}","Clinical Summary":"{{notes.course}}","Diet Advice":"<p>{{diet.current}}</p>","Advice & Follow-up":"{{narrative.advice}}","Condition at Referral":"<p>{{vitals.latest}}</p>","Condition at Time of Leaving":"<p>{{vitals.latest}}</p>"},n=(Hl[t]??["Details","Advice"]).map(r=>`<h3>${r}</h3>
${e[r]??"<p></p>"}`).join(`

`);return`<h2 style="text-align:center;margin:0 0 4px">${wn(t).toUpperCase()}</h2>
${Gl}

${n}

<br/><br/>
<table style="width:100%;font-size:13px">
  <tr>
    <td><b>Dr. {{doctor.name}}</b><br/>Consultant</td>
    <td style="text-align:right">Date: {{discharge.date}}</td>
  </tr>
</table>
`}const Ut=t=>Ql[t]??Kl(t),qe=t=>`Default ${wn(t)}`,l=t=>t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"),H=(t,e)=>{const n=[t.address,t.phone?`Ph: ${t.phone}`:null].filter(Boolean).join(" · ");return`<div>
      ${t.name?`<h1>${l(t.name)}</h1>`:""}
      ${n?`<div class="sub">${l(n)}</div>`:""}
      <div class="sub">${l(e)}</div>
    </div>`},En=new Map(kn.map(t=>[t.code,t.label.split("—")[0].trim()])),Et=t=>t?["iv","im","sc"].includes(t)?t.toUpperCase():t.replace(/_/g," "):"",V=t=>new Date(t).toLocaleDateString("en-IN",{day:"2-digit",month:"short"});function Jl(t){const e=t.filter(r=>r.status==="active");return e.length===0?"<p>None</p>":`<table style="width:100%;font-size:12.5px;border-collapse:collapse">
    <tr>
      <th style="padding:3px 6px;border:1px solid #ccc;text-align:left">Medicine</th>
      <th style="padding:3px 6px;border:1px solid #ccc;text-align:left">Dose</th>
      <th style="padding:3px 6px;border:1px solid #ccc;text-align:left">Route</th>
      <th style="padding:3px 6px;border:1px solid #ccc;text-align:left">Frequency</th>
      <th style="padding:3px 6px;border:1px solid #ccc;text-align:left">Instructions</th>
    </tr>${e.map(r=>`<tr>
        <td style="padding:3px 6px;border:1px solid #ccc">${l(r.medicine_name)}</td>
        <td style="padding:3px 6px;border:1px solid #ccc">${l(r.dose??"—")}</td>
        <td style="padding:3px 6px;border:1px solid #ccc">${l(Et(r.route)||"—")}</td>
        <td style="padding:3px 6px;border:1px solid #ccc">${l(En.get(r.frequency_code)??r.frequency_code.toUpperCase())}</td>
        <td style="padding:3px 6px;border:1px solid #ccc">${l(r.instructions??"")}</td>
      </tr>`).join("")}</table>`}function Zl(t){return t.length===0?"<p>—</p>":`<ul style="margin:4px 0;padding-left:18px">${[...t].sort((n,r)=>n.start_at.localeCompare(r.start_at)).map(n=>{const r=[n.dose,Et(n.route),En.get(n.frequency_code)??n.frequency_code.toUpperCase()].filter(Boolean).join(", "),i=`${V(n.start_at)}${n.end_at?` – ${V(n.end_at)}`:" onwards"}`,a=n.status==="stopped"?", stopped":"";return`<li>${l(n.medicine_name)}${r?` — ${l(r)}`:""} (${i}${a})</li>`}).join("")}</ul>`}async function es(t){const{data:e,error:n}=await s.from("ipd_order_items").select(`status, result_ref, created_at,
             service:services_master(name, service_type),
             parent_order:ipd_orders(order_datetime),
             reports:ipd_reports(impression, findings, is_abnormal)`).eq("admission_id",t).neq("status","cancelled").order("created_at",{ascending:!0});if(n)return"<p>[Key investigation findings]</p>";const r=e.filter(a=>["lab","imaging"].includes(a.service?.service_type));return r.length===0?"<p>[Key investigation findings]</p>":`<ul style="margin:4px 0;padding-left:18px">${r.map(a=>{const o=V(a.parent_order?.order_datetime??a.created_at),d=(a.reports??[]).find(u=>u.impression||u.findings),c=d?` — ${l(d.impression||d.findings)}${d.is_abnormal?" <b>(abnormal)</b>":""}`:typeof a.result_ref?.summary=="string"?` — ${l(a.result_ref.summary)}`:a.status==="resulted"||a.status==="done"?"":" — awaited";return`<li><b>${o}</b> ${l(a.service?.name??"")}${c}</li>`}).join("")}</ul>`}async function ts(t){const{data:e,error:n}=await s.from("ipd_reports").select("title, report_type, report_date, impression, findings, is_abnormal").eq("admission_id",t).order("report_date",{ascending:!0});return n||!e||e.length===0?"<p>No reports filed.</p>":`<ul style="margin:4px 0;padding-left:18px">${e.map(i=>{const a=i.impression||i.findings||"report on file";return`<li><b>${V(i.report_date)}</b> ${l(i.title)} <i>(${i.report_type})</i> — ${l(a)}${i.is_abnormal?" <b>(abnormal)</b>":""}</li>`}).join("")}</ul>`}async function ns(t){const{data:e,error:n}=await s.from("ipd_consultations").select("specialty, external_doctor_name, reason, opinion, status, requested_at, seen_at, doctor:profiles!ipd_consultations_doctor_id_fkey(name)").eq("admission_id",t).neq("status","cancelled").order("requested_at",{ascending:!0});return n||!e||e.length===0?"<p>None.</p>":`<ul style="margin:4px 0;padding-left:18px">${e.map(i=>{const a=i.doctor?.name?`Dr. ${String(i.doctor.name).replace(/^dr\.?\s*/i,"")}`:i.external_doctor_name??"",o=[i.specialty,a].filter(Boolean).join(" — "),d=i.opinion?l(i.opinion):"opinion awaited";return`<li><b>${V(i.seen_at??i.requested_at)}</b> ${l(o||"Consultation")}: ${l(i.reason??"")} → ${d}</li>`}).join("")}</ul>`}async function rs(t){const{data:e,error:n}=await s.from("ipd_diet_orders").select("diet_type, route, calories_kcal, protein_g, fluid_restriction_ml, special_instructions, restrictions").eq("admission_id",t).eq("status","active").order("created_at",{ascending:!1}).limit(1).maybeSingle();if(n||!e)return"[Diet advice on discharge]";const r=e,i=[`${String(r.diet_type).replace(/_/g," ")} diet`,r.route&&r.route!=="oral"?String(r.route).replace(/_/g," "):null,r.calories_kcal?`${r.calories_kcal} kcal/day`:null,r.protein_g?`${r.protein_g} g protein/day`:null,r.fluid_restriction_ml?`fluids ${r.fluid_restriction_ml} ml/day`:null,r.special_instructions||null,r.restrictions?`avoid ${r.restrictions}`:null].filter(Boolean);return l(i.join(" · "))}function is(t,e){const n=[...t.filter(r=>r.note_type==="doctor_round"||r.note_type==="progress").map(r=>({at:r.created_at,html:l(r.note)})),...e.map(r=>({at:r.recorded_at,html:[["S",r.subjective],["O",r.objective],["A",r.assessment],["Plan",r.plan],["Advice",r.advice]].filter(([,i])=>i&&i.trim()).map(([i,a])=>`<i>${i}:</i> ${l(a)}`).join(" · ")})).filter(r=>r.html)].sort((r,i)=>r.at.localeCompare(i.at));return n.length===0?"<p>[Describe the clinical course during the stay]</p>":n.map(r=>`<p style="margin:3px 0"><b>${new Date(r.at).toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}</b> — ${r.html}</p>`).join("")}const M="border:1px solid #cbd5e1;padding:3px 5px",as=`${M};background:#f1f5f9;text-align:left`,re=t=>new Date(t).toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}),os=10*6e4,Ot=(t,e)=>{const n=re(t);return!e||new Date(e).getTime()-new Date(t).getTime()<os?n:`${n} (charted ${new Date(e).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})})`},K=t=>t?.name?t.name.replace(/^dr\.?\s*/i,""):"",Ie=(t,e)=>`<table style="width:100%;border-collapse:collapse;font-size:12px">
  <tr>${t.map(n=>`<th style="${as}">${n}</th>`).join("")}</tr>
  ${e}
</table>`,De=t=>`<tr>${t.map(e=>`<td style="${M}">${e}</td>`).join("")}</tr>`;function ds(t){if(t.length===0)return"<p>[No vitals charted yet — record them under Nursing, or fill this sheet by hand]</p>";const e=[...t].sort((n,r)=>n.recorded_at.localeCompare(r.recorded_at)).map(n=>De([l(Ot(n.recorded_at,n.charted_at)),l(n.bp_systolic!=null?`${n.bp_systolic}/${n.bp_diastolic??"—"}`:"—"),l(n.pulse!=null?String(n.pulse):"—"),l(n.spo2!=null?`${n.spo2}%`:"—"),l(n.temperature!=null?`${n.temperature}°C`:"Afebrile"),l(n.resp_rate!=null?String(n.resp_rate):"—"),l(n.blood_sugar!=null?String(n.blood_sugar):"—"),l(K(n.recorder))])).join("");return Ie(["Date &amp; Time","BP (mmHg)","Pulse /min","SpO₂","Temp","RR /min","Sugar","Sign"],e)}function ls(t){if(t.length===0)return"<p>[No intake/output charted — record it under Nursing, or fill this sheet by hand]</p>";let e=0,n=0;const r=[...t].sort((a,o)=>a.recorded_at.localeCompare(o.recorded_at)).map(a=>{const o=a.io_type==="intake";return o?e+=a.volume_ml:n+=a.volume_ml,De([l(Ot(a.recorded_at,a.charted_at)),l(a.route.replace(/_/g," ")),o?l(`${a.volume_ml} ml`):"",o?"":l(`${a.volume_ml} ml`),l(String(e-n)),l([a.notes,K(a.recorder)].filter(Boolean).join(" · "))])}).join(""),i=`<tr>
    <td style="${M};background:#f8fafc" colspan="2"><b>Total</b></td>
    <td style="${M};background:#f8fafc"><b>${e} ml</b></td>
    <td style="${M};background:#f8fafc"><b>${n} ml</b></td>
    <td style="${M};background:#f8fafc"><b>${e-n} ml</b></td>
    <td style="${M};background:#f8fafc"></td>
  </tr>`;return Ie(["Date &amp; Time","Route","Intake","Output","Balance","Notes / Sign"],r+i)}async function ss(t){const{data:e,error:n}=await s.from("ipd_medication_administrations").select(`administered_at, status, reason,
             nurse:profiles!ipd_medication_administrations_administered_by_fkey(name),
             schedule:ipd_medication_schedule(
               scheduled_at,
               medication_order:ipd_medication_orders(medicine_name, dose, route))`).eq("admission_id",t).order("administered_at",{ascending:!0});if(n||!e||e.length===0)return"<p>[No doses recorded against the eMAR — enter them under Nursing &amp; Medications, or sign this sheet by hand]</p>";const r=e.map(i=>{const a=i.schedule?.medication_order,o=[a?.medicine_name,a?.dose,Et(a?.route??null)].filter(Boolean).join(" "),d=i.schedule?.scheduled_at?re(i.schedule.scheduled_at):"—",c=i.status==="given"?"Given":`${i.status.charAt(0).toUpperCase()}${i.status.slice(1)}${i.reason?` — ${i.reason}`:""}`;return De([l(d),l(re(i.administered_at)),l(o||"—"),l(c),l(K(i.nurse))])}).join("");return Ie(["Due","Given at","Drug / Dose / Route","Status","Sign"],r)}function cs(t){const e=t.filter(n=>["nursing","handover","procedure"].includes(n.note_type)).sort((n,r)=>n.created_at.localeCompare(r.created_at));return e.length===0?"<p></p>":e.map(n=>{const r=n.note_type==="nursing"?"":` <i>(${n.note_type})</i>`,i=K(n.author);return`<p style="margin:3px 0"><b>${l(Ot(n.created_at,n.charted_at))}</b>${r} — ${l(n.note)}${i?` <i>— ${l(i)}</i>`:""}</p>`}).join("")}async function us(t){const{data:e,error:n}=await s.from("ipd_nursing_tasks").select("task, due_at, done_at, nurse:profiles!ipd_nursing_tasks_done_by_fkey(name)").eq("admission_id",t).eq("status","done").not("done_at","is",null).order("done_at",{ascending:!0});if(n)return"<p></p>";const r=e??[];if(r.length===0)return"<p></p>";const i=r.map(a=>De([l(re(a.done_at)),l(a.task),l(a.due_at?re(a.due_at):"—"),l(K(a.nurse))])).join("");return Ie(["Done at","Care given","Was due","Sign"],i)}function fs(t){const e=new Date().toISOString().slice(0,10),n=t.filter(r=>r.plan_date===e&&r.status==="active").sort((r,i)=>r.recorded_at.localeCompare(i.recorded_at));return n.length===0?"<p></p>":n.map(r=>{const i=[["S",r.subjective],["O",r.objective],["A",r.assessment],["Plan",r.plan],["Advice",r.advice]].filter(([,d])=>d&&d.trim()).map(([d,c])=>`<i>${d}:</i> ${l(c)}`).join("<br/>");if(!i)return"";const a=new Date(r.recorded_at).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}),o=K(r.doctor);return`<p style="margin:3px 0"><b>${l(a)}</b>${o?` <i>Dr. ${l(o)}</i>`:""}<br/>${i}</p>`}).filter(Boolean).join("")}async function ps(t){const[e,n,r,i,a,o,d,c,u,h,b]=await Promise.all([Ne.listVitals(t.id,60).catch(()=>[]),Ne.listIO(t.id,200).catch(()=>[]),Ne.listNotes(t.id,200).catch(()=>[]),Ll.list(t.id).catch(()=>[]),s.from("ipd_medication_orders").select("*").eq("admission_id",t.id).then(({data:O})=>O??[]),es(t.id),ts(t.id),ns(t.id),rs(t.id),ss(t.id),us(t.id)]),A=is(r,i),m=e[0],se=m?[m.temperature!=null?`Temp ${m.temperature}°C`:null,m.pulse!=null?`Pulse ${m.pulse}/min`:null,m.bp_systolic!=null?`BP ${m.bp_systolic}/${m.bp_diastolic??"?"}`:null,m.spo2!=null?`SpO₂ ${m.spo2}%`:null,m.resp_rate!=null?`RR ${m.resp_rate}/min`:null].filter(Boolean).join(", "):"—",J=O=>O?new Date(O).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}):"—",ce=O=>O?new Date(O).toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}):"—",p=t.discharge_datetime??new Date().toISOString(),_=Math.max(1,Math.ceil((new Date(p).getTime()-new Date(t.admission_datetime).getTime())/864e5)),ke={routine:"Routine",dama:"DAMA (against medical advice)",referred:"Referred",expired:"Expired",absconded:"Absconded"};return{"patient.name":t.patient?.name??"","patient.uhid":t.patient?.patient_number??"—","patient.age":String(t.patient?.age??""),"patient.gender":t.patient?.gender??"","patient.age_sex":[t.patient?.age!=null?String(t.patient.age):"—",t.patient?.gender?t.patient.gender.charAt(0).toUpperCase():"—"].join(" / "),"patient.phone":t.patient?.phone??"","patient.blood_group":t.patient?.blood_group??"—","patient.allergies":t.patient?.allergies?.join(", ")||"None known","admission.number":t.admission_number,"admission.date":J(t.admission_datetime),"admission.datetime":ce(t.admission_datetime),"admission.attendant":[t.attendant_name,t.attendant_phone].filter(Boolean).join(" · ")||"—",today:J(new Date().toISOString()),now:ce(new Date().toISOString()),"admission.bed":t.current_bed?`${t.current_bed.ward?.name??""} / ${t.current_bed.bed_number}`:"—","admission.diagnosis":t.provisional_diagnosis??"","admission.reason":t.reason_for_admission??"","admission.icd_codes":t.icd10_codes?.join(", ")||"—","admission.los":String(_),"doctor.name":t.admitting_doctor?.name?.replace(/^dr\.?\s*/i,"")??"","discharge.date":J(p),"discharge.type":t.discharge_type?ke[t.discharge_type]??t.discharge_type:"Routine","vitals.latest":se,"vitals.chart":ds(e),"io.chart":ls(n),"medications.discharge":Jl(a),"medications.course":Zl(a),"medications.administered":h,"investigations.list":o,"reports.list":d,"consultations.list":c,"diet.current":u,"notes.nursing":cs(r),"tasks.done":b,"plan.today":fs(i),"notes.course":A,"narrative.course":A,"narrative.advice":"<p>[Activity, wound care, warning signs, follow-up date]</p>","narrative.condition":"Stable"}}const _s=t=>/\{\{\s*narrative\./.test(t);function Vt(t,e){return t.replace(/\{\{\s*([\w.]+)\s*\}\}/g,(n,r)=>e[r]??`{{${r}}}`)}async function hs(t){const e={patient:`${t["patient.name"]} (${t["patient.age"]}y / ${t["patient.gender"]})`,allergies:t["patient.allergies"],diagnosis:t["admission.diagnosis"],icd_codes:t["admission.icd_codes"],reason_for_admission:t["admission.reason"],admitted_on:t["admission.date"],discharged_on:t["discharge.date"],discharge_type:t["discharge.type"],length_of_stay_days:t["admission.los"],vitals_at_discharge:t["vitals.latest"],round_and_plan_notes_html:t["notes.course"],investigations_html:t["investigations.list"],reports_html:t["reports.list"],consultations_html:t["consultations.list"],medications_during_stay_html:t["medications.course"],medications_on_discharge_html:t["medications.discharge"],diet_advice:t["diet.current"]},{data:n,error:r}=await s.functions.invoke("ai-discharge-summary",{body:{context:e}});if(r)throw new Error(r.message??"AI discharge summary failed");if(n?.error)throw new Error(n.error);const i=n?.narrative;return i?{...t,"narrative.course":i.hospital_course?.trim()||t["narrative.course"],"narrative.advice":i.advice_followup?.trim()||t["narrative.advice"],"narrative.condition":i.condition_at_discharge?.trim()||t["narrative.condition"]}:t}const As={async getOrCreateDefaultTemplate(t,e="discharge_summary"){const{data:n}=await s.from("ipd_document_templates").select("*").eq("clinic_id",t).eq("doc_type",e).eq("is_active",!0).order("version",{ascending:!1}).limit(1).maybeSingle();if(n){if(n.name===qe(e)&&(n.version??1)<F){const{data:a}=await s.from("ipd_document_templates").update({html_template:Ut(e),placeholders:Be.map(o=>o.key),version:F,updated_at:new Date().toISOString()}).eq("id",n.id).select().maybeSingle();if(a)return a}return n}const{data:r,error:i}=await s.from("ipd_document_templates").insert({clinic_id:t,doc_type:e,name:qe(e),html_template:Ut(e),placeholders:Be.map(a=>a.key),version:F}).select().single();if(i)throw i;return r},async seedDefaultTemplates(t){const e=await this.listTemplates(t);let n=0;for(const{key:r}of xn){const i=e.find(o=>o.doc_type===r&&o.name===qe(r));if(i&&(i.version??1)>F)continue;const a=!e.some(o=>o.doc_type===r);try{await this.getOrCreateDefaultTemplate(t,r),(a||i)&&(n+=1)}catch{}}return n},async listDocTypeAccess(t){const{data:e,error:n}=await s.from("ipd_doc_type_access").select("doc_type, required_permission").eq("clinic_id",t);return n?{}:Object.fromEntries((e??[]).map(r=>[r.doc_type,r.required_permission]))},async setDocTypeAccess(t){if(t.permission===null){const{error:n}=await s.from("ipd_doc_type_access").delete().eq("clinic_id",t.clinicId).eq("doc_type",t.docType);if(n)throw n;return}const{error:e}=await s.from("ipd_doc_type_access").upsert({clinic_id:t.clinicId,doc_type:t.docType,required_permission:t.permission,updated_at:new Date().toISOString(),updated_by:t.userId??null},{onConflict:"clinic_id,doc_type"});if(e)throw e},async listTemplates(t,e=!1){let n=s.from("ipd_document_templates").select("*").eq("clinic_id",t).order("doc_type").order("name");e&&(n=n.eq("is_active",!0));const{data:r,error:i}=await n;if(i)throw i;return r},async createTemplate(t){const{data:e,error:n}=await s.from("ipd_document_templates").insert({clinic_id:t.clinicId,doc_type:t.docType,name:t.name,html_template:t.htmlTemplate,placeholders:Be.map(r=>r.key),version:F,created_by:t.userId??null}).select().single();if(n)throw n;return e},async updateTemplate(t,e,n){const{error:r}=await s.from("ipd_document_templates").update({...e.name!==void 0?{name:e.name}:{},...e.htmlTemplate!==void 0?{html_template:e.htmlTemplate}:{},...e.isActive!==void 0?{is_active:e.isActive}:{},version:Math.max(n+1,F+1),updated_at:new Date().toISOString()}).eq("id",t);if(r)throw r},async listDocuments(t){const{data:e,error:n}=await s.from("ipd_documents").select("*").eq("admission_id",t).order("created_at",{ascending:!1});if(n)throw n;return e},async createFromTemplate(t){let e=null;if(t.templateId){const{data:c}=await s.from("ipd_document_templates").select("*").eq("id",t.templateId).maybeSingle();e=c}e||(e=await this.getOrCreateDefaultTemplate(t.clinicId,t.docType??"discharge_summary"));const n=e.doc_type;let r=await ps(t.admission);t.useAi&&_s(e.html_template)&&(r=await hs(r));const i=Vt(e.html_template,r),{data:a}=await s.rpc("next_document_number",{p_clinic_id:t.clinicId,p_doc_type:"ipd_doc"}),{data:o,error:d}=await s.from("ipd_documents").insert({clinic_id:t.clinicId,admission_id:t.admission.id,template_id:e.id,doc_type:n,document_number:a??null,content_html:i,charge_posting_id:t.chargePostingId??null,created_by:t.userId??null}).select().single();if(d)throw d;return o},async createPreAdmissionEstimate(t){let e=null;if(t.templateId){const{data:c}=await s.from("ipd_document_templates").select("*").eq("id",t.templateId).maybeSingle();e=c}e||(e=await this.getOrCreateDefaultTemplate(t.clinicId,"estimate"));const n=new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}),{data:r}=await s.rpc("next_document_number",{p_clinic_id:t.clinicId,p_doc_type:"estimate"}),i={"patient.name":t.patient.name,"patient.age":String(t.patient.age??""),"patient.gender":t.patient.gender??"","patient.allergies":(t.patient.allergies??[]).join(", ")||"None known","admission.number":r??"Pre-admission","admission.date":n,"admission.bed":t.bedClassLabel,"admission.diagnosis":t.diagnosis,"admission.reason":t.diagnosis,"doctor.name":t.doctorName.replace(/^dr\.?\s*/i,""),"discharge.date":n,today:n,now:new Date().toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})},a=Vt(e.html_template,i).replace(/\{\{\s*[\w.]+\s*\}\}/g,'<i style="color:#94a3b8">[to be filled]</i>'),{data:o,error:d}=await s.from("ipd_documents").insert({clinic_id:t.clinicId,admission_id:null,patient_id:t.patient.id,template_id:e.id,doc_type:"estimate",document_number:r??null,content_html:a,subject_context:t.subjectContext??null,created_by:t.userId??null}).select().single();if(d)throw d;return o},async listPreAdmissionEstimates(t,e=100){const{data:n,error:r}=await s.from("ipd_documents").select("*, patient:patients(id, name, phone)").eq("clinic_id",t).eq("doc_type","estimate").is("admission_id",null).order("created_at",{ascending:!1}).limit(e);if(r)throw r;return n},async deleteDocument(t){const{error:e}=await s.from("ipd_documents").delete().eq("id",t).eq("status","draft");if(e)throw e},async saveContent(t,e){const{error:n}=await s.from("ipd_documents").update({content_html:e,updated_at:new Date().toISOString()}).eq("id",t).eq("status","draft");if(n)throw n},async finalize(t,e){const{error:n}=await s.from("ipd_documents").update({status:"signed",signed_by:e??null,signed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",t);if(n)throw n},async printBill(t){const e=await I(t.clinicId),n=Xt(t.bill,t.admission,e,!0);P(n)},async printPackageBreakup(t){const{lines:e,packageName:n,agreedPrice:r,admission:i}=t,a=await I(t.clinicId),o=b=>`₹${Number(b).toLocaleString("en-IN",{minimumFractionDigits:2})}`,d=b=>new Date(b).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}),c=D(i.admission_number,{height:30,fontSize:9,margin:2}),u=e.map(b=>`
      <tr>
        <td>${l(b.description)}</td>
        <td class="r">${b.quantity}</td>
        <td class="r">${o(b.unit_rate)}</td>
        <td class="r">${o(b.net)}</td>
      </tr>`).join(""),h=`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${l(i.admission_number)} — package break-up</title>
  <style>
    @page { size: A4; margin: 15mm 12mm 18mm 12mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; }
    .letterhead { display: flex; justify-content: space-between; align-items: center;
      border-bottom: 2px solid #1F5065; padding-bottom: 6px; margin-bottom: 10px; }
    .letterhead h1 { margin: 0; font-size: 17px; color: #1F5065; }
    .sub { font-size: 10px; color: #555; }
    .meta { display: flex; justify-content: space-between; font-size: 11px;
      background: #f4f6f8; border-radius: 6px; padding: 8px 10px; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 10px; text-transform: uppercase; color: #666;
      border-bottom: 1px solid #bbb; padding: 4px 6px; }
    td { padding: 4px 6px; border-bottom: 1px solid #eee; }
    .r { text-align: right; }
    .totals { margin-top: 10px; margin-left: auto; width: 55%; font-size: 12px; }
    .totals td { padding: 3px 6px; }
    .totals .grand td { font-size: 14px; font-weight: bold; border-top: 2px solid #1F5065; }
    .sign { margin-top: 30px; display: flex; justify-content: space-between; font-size: 11px; }
    .footer { position: fixed; bottom: 0; left: 0; right: 0; font-size: 9.5px; color: #777;
      border-top: 1px solid #ddd; padding-top: 3px; display: flex; justify-content: space-between; }
  </style>
</head>
<body>
  <div class="letterhead">
    ${H(a,"Package Break-up — Claim Annexure")}
    <img src="${c}" alt="${l(i.admission_number)}" style="height:32px" />
  </div>

  <div class="meta">
    <div>
      <b>${l(i.patient?.name??"")}</b>
      (${i.patient?.age??"—"}y / ${l(i.patient?.gender??"—")})<br/>
      ${l(i.patient?.phone??"")}
    </div>
    <div>
      Admission: <b>${l(i.admission_number)}</b><br/>
      Admitted: ${d(i.admission_datetime)}
    </div>
    <div>
      Package: <b>${l(n)}</b><br/>
      Agreed: ${o(r)}
    </div>
  </div>

  <table>
    <thead>
      <tr><th>Head</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr>
    </thead>
    <tbody>${u}</tbody>
  </table>

  <table class="totals">
    <tr class="grand"><td>Package Total</td><td class="r">${o(r)}</td></tr>
  </table>

  <div class="sign">
    <span>Patient / Attendant Signature</span>
    <span>Authorised Signatory</span>
  </div>

  <div class="footer">
    <span>${l(i.admission_number)} · package break-up</span>
    <span>Generated ${new Date().toLocaleString("en-IN")}</span>
  </div>
</body>
</html>`;P(h)},async printPaymentReceipt(t){const{payment:e,bill:n,admission:r}=t,i=await I(t.clinicId),a=h=>`₹${Number(h).toLocaleString("en-IN",{minimumFractionDigits:2})}`,o=e.record_type==="refund",d=D(r.admission_number,{height:26,fontSize:8,margin:2}),c=Math.max(t.balanceAfter??n.balance_amount-(o?-e.amount:e.amount),0),u=`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${e.receipt_number}</title>
  <style>
    @page { size: A5 landscape; margin: 10mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; }
    .head { display: flex; justify-content: space-between; align-items: center;
      border-bottom: 2px solid #1F5065; padding-bottom: 6px; margin-bottom: 10px; }
    .head h1 { margin: 0; font-size: 16px; color: #1F5065; }
    .sub { font-size: 10px; color: #555; }
    .title { text-align: center; font-size: 13px; font-weight: bold; letter-spacing: 2px;
      color: ${o?"#b91c1c":"#1F5065"}; margin: 6px 0 12px; }
    table { width: 100%; font-size: 12px; border-collapse: collapse; }
    td { padding: 4px 6px; }
    td:first-child { color: #555; width: 38%; }
    .amount { font-size: 20px; font-weight: bold; color: ${o?"#b91c1c":"#047857"};
      border: 1px dashed #999; border-radius: 6px; padding: 8px 14px; display: inline-block; margin: 10px 0; }
    .sign { margin-top: 24px; display: flex; justify-content: space-between; font-size: 11px; }
  </style>
</head>
<body>
  <div class="head">
    ${H(i,"Inpatient Department")}
    <img src="${d}" style="height:26px" alt="${r.admission_number}" />
  </div>
  <div class="title">${o?"PAYMENT REFUND RECEIPT":"PAYMENT RECEIPT"}</div>
  <table>
    <tr><td>Receipt No</td><td><b>${e.receipt_number}</b></td></tr>
    <tr><td>Date</td><td>${new Date(e.received_at).toLocaleString("en-IN")}</td></tr>
    <tr><td>Patient</td><td><b>${r.patient?.name??""}</b> (${r.patient?.phone??""})</td></tr>
    <tr><td>Admission No</td><td>${r.admission_number}</td></tr>
    <tr><td>Against Bill</td><td>${n.bill_number} (${n.bill_type.toUpperCase()})</td></tr>
    <tr><td>Mode</td><td style="text-transform:capitalize">${e.payment_method.replace("_"," ")}${e.reference?` · ${e.reference}`:""}</td></tr>
    <tr><td>Balance after this receipt</td><td><b>${a(c)}</b></td></tr>
  </table>
  <div style="text-align:center">
    <span class="amount">${o?"− ":""}${a(e.amount)}</span>
  </div>
  <div class="sign">
    <span>Received from (Patient/Attendant)</span>
    <span>Authorised Signatory</span>
  </div>
</body>
</html>`;P(u)},async printDepositReceipt(t){const{deposit:e,admission:n}=t,r=await I(t.clinicId),i=c=>`₹${Number(c).toLocaleString("en-IN",{minimumFractionDigits:2})}`,a=e.entry_type==="refund",o=D(n.admission_number,{height:26,fontSize:8,margin:2}),d=`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${e.receipt_number}</title>
  <style>
    @page { size: A5 landscape; margin: 10mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; }
    .head { display: flex; justify-content: space-between; align-items: center;
      border-bottom: 2px solid #1F5065; padding-bottom: 6px; margin-bottom: 10px; }
    .head h1 { margin: 0; font-size: 16px; color: #1F5065; }
    .sub { font-size: 10px; color: #555; }
    .title { text-align: center; font-size: 13px; font-weight: bold; letter-spacing: 2px;
      color: ${a?"#b91c1c":"#1F5065"}; margin: 6px 0 12px; }
    table { width: 100%; font-size: 12px; border-collapse: collapse; }
    td { padding: 4px 6px; }
    td:first-child { color: #555; width: 38%; }
    .amount { font-size: 20px; font-weight: bold; color: ${a?"#b91c1c":"#047857"};
      border: 1px dashed #999; border-radius: 6px; padding: 8px 14px; display: inline-block; margin: 10px 0; }
    .sign { margin-top: 28px; display: flex; justify-content: space-between; font-size: 11px; }
  </style>
</head>
<body>
  <div class="head">
    ${H(r,"Inpatient Department")}
    <img src="${o}" style="height:26px" alt="${n.admission_number}" />
  </div>
  <div class="title">${a?"DEPOSIT REFUND RECEIPT":"ADVANCE DEPOSIT RECEIPT"}</div>
  <table>
    <tr><td>Receipt No</td><td><b>${e.receipt_number}</b></td></tr>
    <tr><td>Date</td><td>${new Date(e.received_at).toLocaleString("en-IN")}</td></tr>
    <tr><td>Patient</td><td><b>${n.patient?.name??""}</b> (${n.patient?.phone??""})</td></tr>
    <tr><td>Admission No</td><td>${n.admission_number}</td></tr>
    <tr><td>Consultant</td><td>Dr. ${n.admitting_doctor?.name?.replace(/^dr\.?\s*/i,"")??""}</td></tr>
    <tr><td>Mode</td><td style="text-transform:capitalize">${(e.payment_method??"—").replace("_"," ")}</td></tr>
  </table>
  <div style="text-align:center">
    <span class="amount">${a?"− ":""}${i(e.amount)}</span>
  </div>
  <div class="sign">
    <span>Received ${a?"by (Patient/Attendant)":"from (Patient/Attendant)"}</span>
    <span>Authorised Signatory</span>
  </div>
</body>
</html>`;P(d)},async printDietChart(t){const{order:e,entries:n,date:r}=t,i=await I(t.clinicId),a=e?Bl.find(c=>c.key===e.diet_type)?.label??e.diet_type:"No diet ordered",o=e?`<table class="kv">
          <tr><td>Diet</td><td><b>${l(a)}</b> · ${l(String(e.route).replace(/_/g," "))}</td></tr>
          <tr><td>Targets</td><td>${[e.calories_kcal?`${e.calories_kcal} kcal/day`:null,e.protein_g?`${e.protein_g} g protein/day`:null,e.fluid_restriction_ml?`fluids ${e.fluid_restriction_ml} ml/day`:null].filter(Boolean).join(" · ")||"—"}</td></tr>
          <tr><td>Instructions</td><td>${l(e.special_instructions??"—")}</td></tr>
          <tr><td>Avoid</td><td>${l(e.restrictions??"—")}</td></tr>
        </table>`:'<p style="color:#b45309"><b>No diet order in force — confirm with the treating doctor.</b></p>',d=Nl.map(c=>{const u=n.find(h=>h.meal===c.key&&h.entry_date===r);return`<tr>
        <td>${c.label}<span style="color:#777"> · ${c.time}</span></td>
        <td>${l(u?.items??"")}</td>
        <td style="text-transform:capitalize">${u?.status??""}</td>
        <td>${u?.intake_percent!=null?`${u.intake_percent}%`:""}</td>
        <td></td>
      </tr>`}).join("");P(Fe({title:"DIET CHART",subtitle:new Date(r).toLocaleDateString("en-IN",{weekday:"short",day:"2-digit",month:"short",year:"numeric"}),admission:t.admission,clinic:i,body:`${o}
        <table class="grid">
          <thead><tr><th>Meal</th><th>Items served</th><th>Status</th><th>Intake</th><th>Nurse sign</th></tr></thead>
          <tbody>${d}</tbody>
        </table>`}))},async printOrderSheet(t){const e=await I(t.clinicId),n=t.items.filter(r=>r.status!=="cancelled").map(r=>`<tr>
          <td>${r.parent_order?.order_datetime?V(r.parent_order.order_datetime):""}</td>
          <td>${l(r.service?.name??"")}${r.quantity>1?` × ${r.quantity}`:""}</td>
          <td style="text-transform:uppercase">${r.parent_order?.priority??"routine"}</td>
          <td style="text-transform:capitalize">${r.status.replace("_"," ")}</td>
          <td>${l(r.parent_order?.clinical_notes??"")}</td>
          <td></td>
        </tr>`).join("");P(Fe({title:"INVESTIGATION ORDER SHEET",subtitle:`Printed ${new Date().toLocaleString("en-IN")}`,admission:t.admission,clinic:e,body:n?`<table class="grid">
            <thead><tr><th>Date</th><th>Test / procedure</th><th>Priority</th><th>Status</th><th>Instructions</th><th>Collected by</th></tr></thead>
            <tbody>${n}</tbody>
          </table>`:"<p>No investigations ordered.</p>"}))},async printPlanSheet(t){const e=await I(t.clinicId),n=[...t.plans].sort((i,a)=>i.recorded_at.localeCompare(a.recorded_at)),r=n.map(i=>{const a=[["Subjective",i.subjective],["Objective",i.objective],["Assessment",i.assessment],["Plan",i.plan],["Advice",i.advice]].filter(([,o])=>o&&o.trim()).map(([o,d])=>`<p style="margin:2px 0"><b>${o}:</b> ${l(d)}</p>`).join("");return`<div class="entry">
          <div class="entry-head">${new Date(i.plan_date).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})} · ${new Date(i.recorded_at).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}${i.doctor?.name?` · Dr. ${l(i.doctor.name.replace(/^dr\.?\s*/i,""))}`:""}</div>
          ${a}
        </div>`}).join("");P(Fe({title:"TREATMENT PLAN / PROGRESS SHEET",subtitle:`${n.length} entr${n.length===1?"y":"ies"}`,admission:t.admission,clinic:e,body:r||"<p>No plan documented.</p>"}))},async generateBillPdf(t){const e=Xt(t.bill,t.admission,In,!1),{data:n,error:r}=await s.functions.invoke("generate-ipd-pdf",{body:{html:e,docType:"ipd_bill",recordId:t.bill.id,clinicId:t.clinicId,filename:`${t.bill.bill_number}.pdf`,forceRegenerate:t.forceRegenerate??!1}});if(r)throw new Error(r.message??"PDF generation failed");if(n?.error)throw new Error(n.error);return{url:n.url,shareUrl:n.shareUrl??void 0,token:n.token??void 0,temporary:!!n.temporary,cached:!!n.cached}},async generateDocumentPdf(t){const e=t.admission?.admission_number??t.doc.document_number??"ESTIMATE",n=D(e,{height:30,fontSize:9,margin:2}),r=`
      <div style="font-family:Arial,Helvetica,sans-serif;color:#111;font-size:13px;line-height:1.45;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div style="font-size:11px;color:#555;">
            ${t.doc.document_number??""} · ${e}
          </div>
          <img src="${n}" style="height:30px" />
        </div>
        ${t.doc.content_html}
      </div>`,{data:i,error:a}=await s.functions.invoke("generate-ipd-pdf",{body:{html:r,docType:"ipd_document",recordId:t.doc.id,clinicId:t.clinicId,filename:`${t.doc.document_number??t.doc.doc_type}.pdf`,forceRegenerate:t.forceRegenerate??!1}});if(a)throw new Error(a.message??"PDF generation failed");if(i?.error)throw new Error(i.error);return{url:i.url,shareUrl:i.shareUrl??void 0,token:i.token??void 0,temporary:!!i.temporary,cached:!!i.cached}},async printDocument(t){const e=await I(t.clinicId),n=t.admission?.admission_number??t.doc.document_number??"ESTIMATE",r=D(n,{height:32,fontSize:9,margin:2}),i=`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${t.doc.document_number??t.doc.doc_type}</title>
  <style>
    @page { size: A4; margin: 18mm 15mm 20mm 15mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 13px; line-height: 1.45; }
    .letterhead { display: flex; justify-content: space-between; align-items: center;
      border-bottom: 2px solid #1F5065; padding-bottom: 8px; margin-bottom: 14px; }
    .letterhead h1 { margin: 0; font-size: 18px; color: #1F5065; }
    .letterhead .sub { font-size: 11px; color: #555; }
    .barcode img { height: 34px; }
    .footer { position: fixed; bottom: 0; left: 0; right: 0; font-size: 10px; color: #777;
      border-top: 1px solid #ddd; padding-top: 3px; display: flex; justify-content: space-between; }
    h2 { font-size: 16px; } h3 { font-size: 13.5px; margin: 12px 0 4px; color: #1F5065; }
    table { border-collapse: collapse; }
  </style>
</head>
<body>
  <div class="letterhead">
    ${H(e,"Inpatient Department")}
    <div class="barcode"><img src="${r}" alt="${n}" /></div>
  </div>
  ${t.doc.content_html}
  <div class="footer">
    <span>${t.doc.document_number??""} · ${n}</span>
    <span>Generated ${new Date().toLocaleString("en-IN")}</span>
  </div>
</body>
</html>`,a=document.createElement("iframe");a.style.position="fixed",a.style.right="-10000px",document.body.appendChild(a);const o=a.contentWindow?.document;o&&(o.open(),o.write(i),o.close(),setTimeout(()=>{a.contentWindow?.focus(),a.contentWindow?.print(),setTimeout(()=>document.body.removeChild(a),2e3)},300))}};function Xt(t,e,n,r){const i=t.lines??[],a=i.filter(p=>p.line_type==="package"),o=i.filter(p=>p.line_type!=="package"),d=new Map;for(const p of o){const _=(p.charge_group_path??"OTHER").split("/")[0]||"OTHER";d.has(_)||d.set(_,[]),d.get(_).push(p)}const c=p=>`₹${Number(p).toLocaleString("en-IN",{minimumFractionDigits:2})}`,u=p=>new Date(p).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}),h=p=>p.map(_=>`
      <tr>
        <td>${_.description}</td>
        <td class="r">${_.quantity}</td>
        <td class="r">${c(_.unit_rate)}</td>
        <td class="r">${_.discount>0?c(_.discount):"—"}</td>
        <td class="r">${c(_.net)}</td>
      </tr>`).join(""),b=[...d.entries()].sort(([p],[_])=>p.localeCompare(_)).map(([p,_])=>{const ke=_.reduce((O,On)=>O+Number(On.net),0);return`
        <tr class="group"><td colspan="5">${p}</td></tr>
        ${h(_)}
        <tr class="subtotal"><td colspan="4" class="r">${p} subtotal</td><td class="r">${c(ke)}</td></tr>`}).join(""),A=a.length?`<tr class="group"><td colspan="5">PACKAGE</td></tr>
       ${h(a)}
       <tr class="subtotal"><td colspan="4" class="r">Package subtotal</td><td class="r">${c(a.reduce((p,_)=>p+Number(_.net),0))}</td></tr>
       ${o.length?'<tr class="note"><td colspan="5">Items below are outside the package (exclusions / non-covered)</td></tr>':""}`:"",m=D(e.admission_number,{height:30,fontSize:9,margin:2}),se=t.is_provisional?"PROVISIONAL STATEMENT":`${t.bill_type.toUpperCase()} BILL`,J=`
    ${r?"@page { size: A4; margin: 15mm 12mm 18mm 12mm; }":""}
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; }
    .letterhead { display: flex; justify-content: space-between; align-items: center;
      border-bottom: 2px solid #1F5065; padding-bottom: 6px; margin-bottom: 10px; }
    .letterhead h1 { margin: 0; font-size: 17px; color: #1F5065; }
    .sub { font-size: 10px; color: #555; }
    .billtitle { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .billtitle b { font-size: 13px; letter-spacing: 1px; color: #1F5065; }
    .meta { display: flex; justify-content: space-between; font-size: 11px;
      background: #f4f6f8; border-radius: 6px; padding: 8px 10px; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 10px; text-transform: uppercase; color: #666;
      border-bottom: 1px solid #bbb; padding: 4px 6px; }
    td { padding: 3.5px 6px; border-bottom: 1px solid #eee; }
    .r { text-align: right; }
    .group td { background: #eef2f5; font-weight: bold; font-size: 10.5px; letter-spacing: 0.5px;
      color: #1F5065; border-bottom: none; }
    .subtotal td { font-weight: 600; border-bottom: 1px solid #ccc; font-size: 11px; }
    .note td { font-size: 10px; color: #888; font-style: italic; border-bottom: none; }
    .totals { margin-top: 10px; margin-left: auto; width: 55%; font-size: 12px; }
    .totals td { padding: 3px 6px; }
    .totals .grand td { font-size: 14px; font-weight: bold; border-top: 2px solid #1F5065; }
    ${r?`.footer { position: fixed; bottom: 0; left: 0; right: 0; font-size: 9.5px; color: #777;
      border-top: 1px solid #ddd; padding-top: 3px; display: flex; justify-content: space-between; }`:""}
    .sign { margin-top: 34px; display: flex; justify-content: space-between; font-size: 11px; }
    .provisional { border: 1px solid #b45309; background: #fffbeb; color: #92400e;
      border-radius: 6px; padding: 6px 9px; font-size: 10.5px; margin-bottom: 9px; }
  `,ce=r?`<div class="letterhead">
        ${H(n,`Inpatient Department — ${se}`)}
        <img src="${m}" alt="${e.admission_number}" style="height:32px" />
      </div>`:`<div class="billtitle">
        <b>${se} — INPATIENT DEPARTMENT</b>
        <img src="${m}" alt="${e.admission_number}" style="height:30px" />
      </div>`;return`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${t.bill_number}</title>
  <style>${J}</style>
</head>
<body>
  ${ce}

  <div class="meta">
    <div>
      <b>${e.patient?.name??""}</b>
      (${e.patient?.age??"—"}y / ${e.patient?.gender??"—"})<br/>
      ${e.patient?.phone??""}
    </div>
    <div>
      Admission: <b>${e.admission_number}</b><br/>
      Admitted: ${u(e.admission_datetime)}
    </div>
    <div>
      Bill No: <b>${t.bill_number}</b><br/>
      Date: ${u(t.bill_datetime)}
    </div>
  </div>

  ${t.is_provisional?`<div class="provisional">
    Provisional — charges recorded up to ${u(t.bill_datetime)}. Not a demand for payment
    and not a tax invoice. The final bill issued at discharge carries every item of this admission.
  </div>`:""}

  <table>
    <thead>
      <tr><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Disc</th><th class="r">Amount</th></tr>
    </thead>
    <tbody>
      ${A}
      ${b}
    </tbody>
  </table>

  <table class="totals">
    <tr><td>Gross Total</td><td class="r">${c(t.gross_total)}</td></tr>
    ${t.discount_total>0?`<tr><td>Discount</td><td class="r">− ${c(t.discount_total)}</td></tr>`:""}
    ${t.tax_total>0?`<tr><td>Tax</td><td class="r">${c(t.tax_total)}</td></tr>`:""}
    <tr><td><b>${t.is_provisional?"Total Charges To Date":"Net Payable"}</b></td><td class="r"><b>${c(t.net_total)}</b></td></tr>
    ${t.deposits_applied>0?`<tr><td>${t.is_provisional?"Advance Held":"Deposits Applied"}</td><td class="r">− ${c(t.deposits_applied)}</td></tr>`:""}
    ${t.paid_amount>0?`<tr><td>Payments Received</td><td class="r">− ${c(t.paid_amount)}</td></tr>`:""}
    <tr class="grand"><td>${t.is_provisional?"Balance If Settled Today":"Balance Due"}</td><td class="r">${c(t.balance_amount)}</td></tr>
  </table>

  ${t.is_provisional?"":`<div class="sign">
    <span>Patient / Attendant Signature</span>
    <span>Authorised Signatory</span>
  </div>`}

  ${r?`<div class="footer">
    <span>${t.bill_number} · ${e.admission_number} · ${t.is_provisional?"PROVISIONAL":t.status.toUpperCase()}</span>
    <span>Generated ${new Date().toLocaleString("en-IN")}</span>
  </div>`:""}
</body>
</html>`}function Fe(t){const{admission:e}=t,n=D(e.admission_number,{height:26,fontSize:8,margin:2}),r=e.current_bed?`${e.current_bed.ward?.name??""} / ${e.current_bed.bed_number}`:"—";return`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${l(t.title)} — ${l(e.admission_number)}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; }
    .head { display: flex; justify-content: space-between; align-items: center;
      border-bottom: 2px solid #1F5065; padding-bottom: 6px; margin-bottom: 8px; }
    .head h1 { margin: 0; font-size: 16px; color: #1F5065; }
    .sub { font-size: 10px; color: #555; }
    .title { text-align: center; font-size: 13px; font-weight: bold; letter-spacing: 2px;
      color: #1F5065; margin: 4px 0 2px; }
    .subtitle { text-align: center; font-size: 10px; color: #666; margin-bottom: 10px; }
    .patient { display: flex; flex-wrap: wrap; gap: 4px 18px; background: #f4f6f8;
      border-radius: 6px; padding: 6px 10px; margin-bottom: 10px; font-size: 11px; }
    .kv { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    .kv td { padding: 3px 6px; vertical-align: top; }
    .kv td:first-child { color: #555; width: 22%; }
    table.grid { width: 100%; border-collapse: collapse; font-size: 11px; }
    table.grid th, table.grid td { border: 1px solid #bbb; padding: 5px 6px; text-align: left;
      vertical-align: top; }
    table.grid th { background: #eef2f5; }
    .entry { border-left: 3px solid #1F5065; padding: 4px 0 4px 8px; margin-bottom: 8px;
      page-break-inside: avoid; }
    .entry-head { font-weight: bold; color: #1F5065; font-size: 11px; margin-bottom: 2px; }
    .sign { margin-top: 26px; display: flex; justify-content: space-between; font-size: 11px; }
  </style>
</head>
<body>
  <div class="head">
    ${H(t.clinic,"Inpatient Department")}
    <img src="${n}" style="height:26px" alt="${l(e.admission_number)}" />
  </div>
  <div class="title">${l(t.title)}</div>
  ${t.subtitle?`<div class="subtitle">${l(t.subtitle)}</div>`:""}
  <div class="patient">
    <span><b>${l(e.patient?.name??"")}</b>${e.patient?.age?` · ${e.patient.age}y`:""}${e.patient?.gender?` / ${l(e.patient.gender)}`:""}</span>
    <span>Adm: ${l(e.admission_number)}</span>
    <span>Bed: ${l(r)}</span>
    <span>Consultant: Dr. ${l(e.admitting_doctor?.name?.replace(/^dr\.?\s*/i,"")??"")}</span>
    ${e.patient?.allergies?.length?`<span style="color:#b91c1c"><b>Allergies:</b> ${l(e.patient.allergies.join(", "))}</span>`:""}
  </div>
  ${t.body}
  <div class="sign">
    <span>Nurse in charge</span>
    <span>Doctor's signature</span>
  </div>
</body>
</html>`}function P(t){const e=document.createElement("iframe");e.style.position="fixed",e.style.right="-10000px",document.body.appendChild(e);const n=e.contentWindow?.document;n&&(n.open(),n.write(t),n.close(),setTimeout(()=>{e.contentWindow?.focus(),e.contentWindow?.print(),setTimeout(()=>document.body.removeChild(e),2e3)},300))}export{Bl as D,Nl as M,Be as P,ws as a,As as b,xn as c,$s as d,wn as e,Os as f,Ss as g,_s as h,ql as i,Es as j,Ne as n,xs as p,Ll as t};
