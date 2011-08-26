/****

NMidi programmatic MIDI sequencer

v1.07.1	2011-08-15	Initial platform release
	copied from Sphere
	prep for platform independence & fromFile updates
----
v1.07	2009-08-18	Bugfix release
	abstracted more controller events
----
v1.06	2009-08-02	Bugfix release
	fixed issue where pitch bend was too coarse (wrongly divided by 256 instead of 128)
----
v1.05	2009-07-31	Bugfix release
	abstracted meta::marker, meta::text, meta::instrumentName adding
----
v1.04	2009-07-21	Bugfix release
	fix delta time issue (needed to round final delta time before adding event instead of floor)
	events now do not require a delta time parameter, but user must explicitly add or set delta beforehand for accurate timing
	abstracted out pan & pitch bend enums
----
v1.03	2009-07-20	Bugfix release
	per-track delta time
	track's delta time set to 0 after successful addition of event
----
v1.02	2009-07-17	Bugfix release
	fixed timing issues
----
v1.01	2009-07-12	New feature release
	abstracted event adders
----
v1.00	2009-07-11	Initial release
	started from scratch
	implemented MThd, MTrk

TODO:
-	implement MSeq.fromFile
****/

function GetByte(b) {return b[0]&0xff;}
function GetUShort(b) {return GetByte(b)+(b.length>1?(b[1]&0xff)<<8:0);}
function GetULong(b) {return GetUShort(b)+(b.length>2?(b[2]&0xff)<<16:0)+(b.length>3?(b[3]&0xff)<<24:0);}
function GetFourCC(b) {return (b.slice(0,4));}
function GetUCS2String(b) {
	if (b.length===0) return "";
	var ret = "";
	var i = 0; while (i<b.length) {
		var ch = GetUShort(b.slice(i));
		if (ch===0) break;
		ret += ""+String.fromCharCode(ch);
		i += 2;
	}
	return {
		length: i,
		toString: function() {return ret;}
	};
}

(function(){
// formerly f_proto.js
if (typeof Object.beget !== 'function') {
	Object.beget = function (o) {
		var F = function() {};
		F.prototype = o;
		return new F;
	};
}

Function.prototype.method = function(name, func) {if (!this.prototype[name]) this.prototype[name] = func;};
Function.method('inherits', function(Parent) {this.prototype = new Parent; return this;});
Function.method('curry', function() {
	var slice = Array.prototype.slice, args = slice.apply(arguments), that = this;
	return function() {
		return that.apply(null, args.concat(slice.apply(arguments)));
	};
});

Object.method('superior', function(name) {var that = this, method = that[name]; return function() {return method.apply(that, arguments);};});

Array.method('pop', function() {return this.splice(this.length-1, 1)[0];});
Array.method('push', function() {this.splice.apply(this, [this.length, 0].concat(Array.prototype.slice.apply(arguments)) );	return this.length;});
Array.method('shift', function() {return this.splice(0, 1)[0];});
Array.method('reduce', function (f, value) { var i = -1; while (++i<this.length) {value = f(this[i], value);} return value;});

/** my custom array search */
Array.method('find', function(f, value) {var i = this.length; while (--i>-1) {if (f(this[i])===value) return i;} return -1;});
Number.method('integer', function() {return Math[this<0?'ceil':'floor'](this);});
String.method('integer', function() {return Math[this<0?'ceil':'floor'](this);});
String.method('trim', function() {return this.replace(/^s+|\s+$/g, '');});
/**** convert unicode string to array of bytes similar to a Sphere ByteArray ****/
String.method('toByteArray', function() {
	var r = CreateByteArrayFromString(this);	// shallow create, no multibyte checking
	/*var isBigEndian = arguments.length>0?(arguments[0]?1:0):0;
	var r = CreateByteArray(0), _q = CreateByteArray(0), _r = CreateByteArray(0), i = -1, c; while (++i<this.length) {
		c = this.charCodeAt(i);
		if (c<256) {_q[0] = c; r.concat(_q);}
		else {
			_q[0] = (isBigEndian?c>>8:c)&0xff;
			_r[0] = (isBigEndian?c:c>>8)&0xff;
			r.concat(_q); r.concat(_r);
		}
	}*/
	return r;
});
/**** convert array of bytes similar to a Sphere ByteArray to binary string ****/
String.method('fromByteArray', function(a) {
	/*var r = "", i = -1; while (++i<a.length) {
		r += ""+this.fromCharCode(a[i]);
	}*/
	var r = String.fromCharCode.apply(null, a);
	//console.log("fromByteArray r="+r);
	return r;
});
RegExp.method('test', function(str) {return this.exec(str) !== null;});

// formerly f_req.js
Number.method('toBEByte', function() {return [this.integer()&0xff];});
Number.method('toBEShort', function() {return [(this.integer()>>8).toBEByte(),this.toBEByte()];});
Number.method('toBE24', function() {return [(this.integer()>>16).toBEByte()].concat(this.toBEShort());});
Number.method('toBELong', function() {return [(this.integer()>>24).toBEByte()].concat(this.toBE24());});
Number.method('toHMS', function() {
	var s = this.integer(); var t = s%60, m = 0, h = 0;
	if (s>60) {
		m = (s-t)/60; s = t; t = m%60;
		if (m>60) {
			h = (m-t)/60; m = t;
		}
	}
	return (h>0?h+":":"")+(h>0&&m<10?'0':'')+m+":"+(s<10?'0':'')+s;
});

})();


var MSeq = function() {
	var _cclist = function() {
		return {
			bankSelect:0,
			modWheel:1,
			breathControl:2,
			footControl:4,
			portamentoTime:5,
			dataEntry:6,
			volume:7,
			balance:8,
			pan:10,
			expression:11,
			sustain:64,
			pedalLegato:68,
			pedalHold2:69,
			scVariation:70,
			scTimbre:71,
			scReleaseTime:72,
			scAttackTime:73,
			scBrightness:74,
			rpnFine:100,
			rpnCoarse:101,
			allOffControllers:121,
			allOffNotes:123,
			rpnList:(function(){return {pbSensitivity:0, tuneFine:1, tuneCoarse:2};})()
		};
	}();
	var _metalist = function() {
		return {
			sequence:0x00,
			text:0x01,
			copyright:0x02,
			sequenceName:0x03,
			instrumentName:0x04,
			lyric:0x05,
			marker:0x06,
			cuePoint:0x07,
			port:0x21,
			end:0x2F,
			tempo:0x51,
			smpteOffset:0x54,
			timeSig:0x58,
			keySig:0x59,
			proprietary:0x7F
		};
	}();
	var _pan = (function(){
		var o = {
			get left(){return 0x00;},
			get center(){return 0x3F;},
			get right(){return 0x7F;}
		}
		return o;
	})();
	var ToVarLen = function(n) {
		if (typeof n!=='number') throw new Error("cannot convert non-number to variable length");
		n = n.integer(); var buf = n&0x7f;
		while ((n>>=7)>0) {
			buf <<= 8;
			buf |= 0x80;
			buf += (n&0x7f);
		}
		var b = [];
		var go = 1; while (go) {
			b = b.concat(buf.toBEByte());
			if (buf&0x80) buf >>=8;
			else go = 0;
		}
		return b;
	};
	var FromVarLen = function(b) {
		if (!b||b.length===0) throw new Error("cannot convert empty byte-array from variable length to number");
		var i = 0; val = b[i];
		if (val&0x80) {
			val &= 0x7f;
			do {
				val = (val<<7)+(b[++i]&0x7f);
			} while (b[i]&0x80);
		}
		return val;
	};
	var MThd = function() {
		var _id = 'MThd', _fmt = 0, _len = 6, _fps = -30, _res = 4;
		return {
			get id() {return _id;},
			get length() {return _len;},
			get format() {return _fmt;},
			set format(v) {
				if (typeof v!=='number') throw new Error('invalid MIDI sequence format');
				else if (v===0||v===1) _fmt = v;
				else throw new Error('unsupported MIDI sequence format');
			},
			get tracks() {return _trks.length;},
			get timecode() {return _fps;},
			set timecode(v) {
				if (typeof v!=='number') throw new Error('invalid MIDI sequence format');
				else if (v>=0||v===-24||v===-25||v===-29||v===-30) _fps = v.integer();
				else throw new Error('unsupported MIDI sequence timecode');
			},
			get resolution() {return _res;},
			set resolution(v) {
				if (typeof v!=='number') throw new Error('invalid MIDI sequence format');
				else if (v<1) throw new Error('invalid MIDI resolution');
				else _res = v.integer();;
			},
			get ticksPerBeat() {return Math.abs(_fps*_res)},
			toByteArray: function() {
				var b = (_id).toByteArray();
				b = b.concat(_len.toBELong());
				b = b.concat(_fmt.toBEShort());
				b = b.concat(_trks.length.toBEShort());
				b = b.concat(_fps.toBEByte());
				b = b.concat(_res.toBEByte());
				return b;
			}
		};
	};
	var MTrk = function() {
		var _ch = [], _id = 'MTrk', _done = 0, _lasttempo = 120, _deltatime = 0;
		var _add = function() {
			if (_done) throw new Error("cannot add events after track is declared done");
			var argv = arguments; if (argv.length<2) throw new Error("invalid MIDI event");
			var dt = Math.round(_deltatime), evt = argv[0].integer()&0xff,
				data = argv[1].integer()&0x7f, data2 = argv.length>2?argv[2].integer()&0x7f:null;
			var b = [];
			switch (evt&0xf0) {
				case 0x80: {	// NOTE OFF
					if (argv.length<3) throw new Error("missing second data byte for note off");
					b = b.concat(ToVarLen(dt));
					b = b.concat(evt.toBEByte());
					b = b.concat(data.toBEByte());
					b = b.concat(data2.toBEByte());
					break;
				}
				case 0x90: {	// NOTE ON
					if (argv.length<3) throw new Error("missing second data byte for note on");
					b = b.concat(ToVarLen(dt));
					b = b.concat(evt.toBEByte());
					b = b.concat(data.toBEByte());
					b = b.concat(data2.toBEByte());
					break;
				}
				case 0xA0: {	// KEY PRESSURE/AFTERTOUCH
					if (argv.length<3) throw new Error("missing second data byte for key pressure");
					b = b.concat(ToVarLen(dt));
					b = b.concat(evt.toBEByte());
					b = b.concat(data.toBEByte());
					b = b.concat(data2.toBEByte());
					break;
				}
				case 0xB0: {	// CONTROL CHANGE
					if (argv.length<3) throw new Error("missing second data byte for control change");
					b = b.concat(ToVarLen(dt));
					b = b.concat(evt.toBEByte());
					b = b.concat(data.toBEByte());
					b = b.concat(data2.toBEByte());
					break;
				}
				case 0xC0: {	// PROGRAM/PATCH CHANGE
					b = b.concat(ToVarLen(dt));
					b = b.concat(evt.toBEByte());
					b = b.concat(data.toBEByte());
					break;
				}
				case 0xD0: {	// CHANNEL PRESSURE/AFTERTOUCH
					b = b.concat(ToVarLen(dt));
					b = b.concat(evt.toBEByte());
					b = b.concat(data.toBEByte());
					break;
				}
				case 0xE0: {	// PITCH BEND
					if (argv.length<3) throw new Error("missing second data byte for pitch bend");
					b = b.concat(ToVarLen(dt));
					b = b.concat(evt.toBEByte());
					b = b.concat(data.toBEByte());
					b = b.concat(data2.toBEByte());
					break;
				}
				case 0xF0: {	// SYSTEM EVENTS
					// handle it
					if (evt===0xFF) {	// META EVENTS
						if (argv.length<3) throw new Error("missing length of meta event");
						data2 = argv[2].integer(); var data3;
						if (data2>0&&argv.length<4) throw new Error("missing data of meta event");
						else data3 = argv[3];
						switch (data) {
							case _metalist['sequence']:	// SEQUENCE #, 2 bytes (ss ss)
								if (data2!==2) throw new Error("meta event 'seq #' must be 2 bytes");
								break;
							case _metalist['text']:	// TEXT
							case _metalist['copyright']:	// COPYRIGHT
							case _metalist['sequenceName']:	// SEQUENCE/TRACK NAME
							case _metalist['instrumentName']:	// INSTRUMENT NAME
							case _metalist['lyric']:	// LYRIC
							case _metalist['marker']:	// MARKER
							case _metalist['cuePoint']:	// CUE POINT
								b = b.concat(ToVarLen(dt));
								b = b.concat(evt.toBEByte());
								b = b.concat(data.toBEByte());
								b = b.concat(ToVarLen(data2));
								b = b.concat((data3).toByteArray().slice(0,data2));
								break;
							case _metalist['port']:	// MIDI PORT, 1 byte (pp)
								if (data2!==1) throw new Error("meta event 'port #' must be 1 byte");
								b = b.concat(ToVarLen(dt));
								b = b.concat(evt.toBEByte());
								b = b.concat(data.toBEByte());
								b = b.concat((1).toBEByte());
								b = b.concat(data3.toBEByte());
								break;
							case _metalist['end']:	// TRACK END
								if (data2!==0) throw new Error("meta event 'track end' must be 0 bytes");
								b = b.concat(ToVarLen(dt));
								b = b.concat(evt.toBEByte());
								b = b.concat(data.toBEByte());
								b = b.concat((0).toBEByte());
								_done = 1;
								break;
							case _metalist['tempo']:	// TEMPO, 3 bytes (tttttt)
								if (data2!==3) throw new Error("meta event 'tempo' must be 3 bytes");
								b = b.concat(ToVarLen(dt));
								b = b.concat(evt.toBEByte());
								b = b.concat(data.toBEByte());
								b = b.concat((3).toBEByte());
								b = b.concat(data3.toBE24());
								break;
							case _metalist['smpteOffset']:	// SMPTE OFFSET, 5 bytes (hr mn se fr ff)
								if (data2!==5) throw new Error("meta event 'SMPTE offset' must be 5 bytes");
								break;
							case _metalist['timeSig']:	// TIME SIG, 4 bytes (nn dd cc bb)
								if (data2!==4) throw new Error("meta event 'time sig' must be 4 bytes");
								b = b.concat(ToVarLen(dt));
								b = b.concat(evt.toBEByte());
								b = b.concat(data.toBEByte());
								b = b.concat((4).toBEByte());
								b = b.concat(data3.slice(0,4));
								break;
							case _metalist['keySig']:	// KEY SIG, 2 bytes (sf mi)
								if (data2!==2) throw new Error("meta event 'key sig' must be 2 bytes");
								b = b.concat(ToVarLen(dt));
								b = b.concat(evt.toBEByte());
								b = b.concat(data.toBEByte());
								b = b.concat((2).toBEByte());
								b = b.concat(data3.slice(0,2));
								break;
							case _metalist['proprietary']:	// PROPRIETARY
								break;
						}
					}
					break;
				}
				default: throw new Error("invalid MIDI event");
			}
			if (b&&b.length>0) {_ch = _ch.concat(b); _deltatime = 0;}
		};
		return {
			get id() {return _id;},
			get length() {return _ch.length;},
			get tempo() {return _lasttempo;},
			get time() {return _deltatime;},
			set time(v) {
				if (typeof v!=='number') throw new Error("delta time must be a number");
				else _deltatime = v;
			},
			addDelta: function(v) {
				if (typeof v!=='number') throw new Error("delta time must be a number");
				else _deltatime += v;
			},
			addNoteOff: function(ch, k) {
				var v = arguments.length>2?arguments[2]:64;
				_add(0x80|(ch&0xf),k&0x7f,v&0x7f);
			},
			addNoteOn: function(ch, k) {
				var v = arguments.length>2?arguments[2]:64;
				if (v===0) this.addNoteOff(ch, k);
				else _add(0x90|(ch&0xf),k&0x7f,v&0x7f);
			},
			addKeyPressure: function(ch, k, v) {_add(0xA0+(ch&0xf),k&0x7f,v&0x7f);},
			addCC: function(ch, c, v) {_add(0xB0+(ch&0xf), c&0x7f, v&0x7f);},
			addVolume: function(ch, v) {this.addCC(ch, _cclist['volume'], v);},
			addPan: function(ch, p) {if (p in _pan) p = _pan[p]; this.addCC(ch,_cclist['pan'],p);},
			addPC: function(ch, p) {_add(0xC0+(ch&0xf),p&0x7f);},
			addChanPressure: function(ch, v) {_add(0xD0+(ch&0xf),v&0x7f);},
			addPB: function(ch, l, m) {_add(0xE0+(ch&0x7f),l&0x7f,m&0x7f);},
			addMeta: function(type, len, data) {_add(0xFF,type&0x7F,len,data);},
			addTempo: function(bpm) {this.addMeta(0x51,3,(60000000/bpm).integer()); _lasttempo = bpm;},
			addTimeSig: function(nn, dd, cc, bb) {
				var b = [nn&0xff, dd&0xff, cc&0xff, bb&0xff];
				this.addMeta(0x58,4,b);
			},
			addKeySig: function(sf, mi) {
				var b = [sf&0xff, mi&0x01];
				this.addMeta(0x59,2,b);
			},
			addSeqName: function(t) {this.addMeta(_metalist['sequenceName'], t.length, t);},
			addInstName: function(t) {this.addMeta(_metalist['instrumentName'], t.length, t);},
			addText: function(t) {this.addMeta(_metalist['text'], t.length, t);},
			addMarker: function(t) {this.addMeta(_metalist['marker'], t.length, t);},
			addEnd: function() {this.addMeta(0x2F,0,null);},
			toByteArray: function() {
				var b = (_id).toByteArray();
				b = b.concat(_ch.length.toBELong());
				b = b.concat(_ch);
				return b;
			}
		};
	};
	var _trks = [], _mthd = MThd();
	var PB = function() {
		var _rng = function(){return {
			get min(){return 0;},
			get center(){return 0x2000;},
			get max(){return 0x3FFF;}
		};}();
		var _sens = 1;
		var semi = function(n2,n1,n) {
			var _two = n2, _one = n1, _half = n;
			return {
				get two(){return _two;},
				get one(){return _one;},
				get half(){return _half;}
			};
		};
		var _dn = semi(0, 0x0FFF, 0x17FF), _up = semi(0x3FFF, 0x2FFF, 0x27FF);
		return {
			get range(){return _rng;},
			get half(){return 0x800;},
			get down(){return _dn;},
			get up(){return _up;},
			get sensitivity(){return 1<<_sens;},
			set sensitivity(v){
				if (typeof v!=='number') throw new Error("pitch bend sensitivity needs to be a power of 2");
				else if (v!=v.integer()) throw new Error("pitch bend sensitivity needs to be an integer");
				else if (v<1||v>6) throw new Error("pitch bend sensitivity out of range");
				else _sens = v.integer();
			},
			get steps(){return 8192>>_sens;}
		};
	};
	var _pb = []; while (_pb.length<16) _pb.push(PB());
	return {
		get format() {return _mthd.format;},
		set format(v) {_mthd.format = v;},
		set timecode(v) {_mthd.timecode = v;},
		set resolution(v) {_mthd.resolution = v;},
		get resolution() {return _mthd.resolution;},
		get pan() {return _pan;},
		pbRange: function(ch) {
			if (ch<0||ch>=_pb.length) throw new Error("pbSteps: channel out of range");
			else return _pb[ch].range;
		},
		pbSteps: function(ch) {
			if (ch<0||ch>=_pb.length) throw new Error("pbSteps: channel out of range");
			else return _pb[ch].steps;
		},
		addTrack: function() {_trks.push(MTrk());},
		removeTrack: function(t) {
			throw new Error("removeTrack: functionality not finalized, DON'T USE");
			if (_trks.length<1) throw new Error("removeTrack: MIDI sequence has no tracks");
			else if (_mthd.format>0) {
				if (_trks.length>1&&t<1) throw new Error("removeTrack: can't remove track 0 yet");
			}
			_trks = _trks.splice(t,1);
		},
		get tracks() {return _mthd.tracks;},
		addDelta: function(d) {
			if (_trks.length<1) throw new Error("addDelta: MIDI sequence has no tracks");
			var t = _trks.length; while (--t>-1) _trks[t].addDelta(d);
		},
		setDelta: function(d) {
			if (_trks.length<1) throw new Error("setDelta: MIDI sequence has no tracks");
			var t = _trks.length; while (--t>-1) _trks[t].time = d;
		},
		setTrackDelta: function(t, d) {
			if (t<0||t>=_trks.length) throw new Error("setTrackDelta: invalid MIDI sequence track number");
			_trks[t].time = d;
		},
		addTrackDelta: function(t, d) {
			if (t<0||t>=_trks.length) throw new Error("addTrackDelta: invalid MIDI sequence track number");
			_trks[t].addDelta(d);
		},
		addNoteOff: function(t, ch, k) {
			if (t<0||t>=_trks.length) throw new Error("addNoteOff: invalid MIDI sequence track number");
			var v = arguments.length>3?arguments[3]:64;
			_trks[t].addNoteOff(ch, k, v);
		},
		addNoteOn: function(t, ch, k) {
			if (t<0||t>=_trks.length) throw new Error("addNoteOn: invalid MIDI sequence track number");
			var v = arguments.length>3?arguments[3]:64;
			_trks[t].addNoteOn(ch, k, v);
		},
		addKeyPressure: function(t, ch, k, v) {
			if (t<0||t>=_trks.length) throw new Error("addKeyPressure: invalid MIDI sequence track number");
			_trks[t].addKeyPressure(ch, k, v);
		},
		addCC: function(t, ch, c, v) {
			if (t<0||t>=_trks.length) throw new Error("addCC: invalid MIDI sequence track number");
			_trks[t].addCC(ch, c, v);
		},
		addVolume: function(t, ch, v) {
			if (t<0||t>=_trks.length) throw new Error("addVolume: invalid MIDI sequence track number");
			_trks[t].addVolume(ch, v);
		},
		addPan: function(t, ch, p) {
			if (t<0||t>=_trks.length) throw new Error("addPan: invalid MIDI sequence track number");
			_trks[t].addPan(ch, p);
		},
		addPC: function(t, ch, p) {
			if (t<0||t>=_trks.length) throw new Error("addPC: invalid MIDI sequence track number");
			_trks[t].addPC(ch, p);
		},
		addChanPressure: function(t, ch, v) {
			if (t<0||t>=_trks.length) throw new Error("addChanPressure: invalid MIDI sequence track number");
			_trks[t].addChanPressure(ch, v);
		},
		addPB: function(t, ch, v) {
			if (t<0||t>=_trks.length) throw new Error("addPB: invalid MIDI sequence track number");
			var l = v.integer()&0x7F, m = (v/128).integer()&0x7F;
			_trks[t].addPB(ch, l, m);
		},
		pbSensitivity: function(ch, v) {
			if (_trks.length<=0) throw new Error("pbSensitivity: MIDI sequence has no tracks");
			var t = _trks.length; while (--t>-1) this.setTrackPBSensitivity(t, ch, v);
		},
		setTrackPBSensitivity: function(t, ch, v) {
			if (t<0||t>=_trks.length) throw new Error("setTrackPBSensitivity: invalid MIDI sequence track number");
			_pb[ch&0xF].sensitivity = v;
			this.addCC(t, ch, _cclist['rpnCoarse'], _cclist.rpnList['pbSensitivity']);	// add rpn 101 pb range 0
			this.addCC(t, ch, _cclist['dataEntry'], _pb[ch&0xF].sensitivity);	// add data entry 6 pitchbend sensitivity
		},
		addMeta: function(t, type, len, data) {
			if (t<0||t>=_trks.length) throw new Error("addMeta: invalid MIDI sequence track number");
			_trks[t].addMeta(type, len, data);
		},
		addSeqName: function(s) {
			if (_trks.length<1) throw new Error("addSeqName: invalid MIDI sequence track number");
			_trks[0].addSeqName(s);
		},
		addTempo: function(bpm) {
			if (_trks.length<1) throw new Error("addTempo: invalid MIDI sequence track number");
			_trks[0].addTempo(bpm);
		},
		addTimeSig: function(nn, dd, cc, bb) {
			if (_trks.length<1) throw new Error("addTimeSig: invalid MIDI sequence track number");
			_trks[0].addTimeSig(nn,dd,cc,bb);
		},
		addKeySig: function(sf, mi) {
			if (_trks.length<1) throw new Error("addKeySig: invalid MIDI sequence track number");
			_trks[0].addKeySig(sf,mi);
		},
		addInstName: function(t, d) {
			if (t<0||t>=_trks.length) throw new Error("addMeta: invalid MIDI sequence track number");
			_trks[t].addSeqName(d);
		},
		addText: function(t, d) {
			if (t<0||t>=_trks.length) throw new Error("addMeta: invalid MIDI sequence track number");
			_trks[t].addText(d);
		},
		addMarker: function(t) {
			if (_trks.length<1) throw new Error("addKeySig: invalid MIDI sequence track number");
			_trks[0].addMarker(t);
		},
		addEnd: function(t) {
			if (t<0||t>=_trks.length) throw new Error("addEnd: invalid MIDI sequence track number");
			_trks[t].addEnd();
		},
		init: function() {
			_trks = []; this.addTrack();
			if (arguments.length>2) {
				var ks = arguments[2];
				this.addKeySig(ks.sf, ks.mi);	// sf sharps/flats, mi major/minor
			}
			if (arguments.length>1) {
				var ts = arguments[1];
				this.addTimeSig(ts.nn, ts.dd, ts.cc, ts.bb);	// nn numerator, dd denominator, cc ticks-per-click, bb 32nd notes per beat
			}
			if (arguments.length>0) this.addTempo(arguments[0]);
		},
		fromFile: function(fn) {throw new Error("fromFile: not implemented yet");},
		toFile: function(fn) {
			//throw new Error("toFile: needs reimplementation");
			var b = _mthd.toByteArray();
			//console.log("writing MThd...");
			var i = -1; while (++i<_trks.length) {
				b = b.concat(_trks[i].toByteArray());
				//console.log("writing MTrk "+i+"...");
			}
			try {
				//console.log("attempting to write...");
				//var f = "".fromByteArray(b), f64 = base64(f);
				//console.log("writing "+f.length+" b of "+b.length+" b (b64enc to "+f64.length+" ch)...");
				//return "data:audio/midi;base64,"+f64;
				//TODO - write browser-friendly file output (data url?)
				var f = OpenRawFile(fn, true);
				f.write(b);
				f.close();
				return 0;
			} catch (e) {
				// TODO - write meaningful error catch
				//console.log(e);
				//Abort(e.fileName+" ("+e.lineNumber+"): "+e.message);
				return e;
			}
		}
	};
};
