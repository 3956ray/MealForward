//#region \0rolldown/runtime.js
var e = (e, t, n) => () => {
	if (n) throw n[0];
	try {
		return e && (t = e(e = 0)), t;
	} catch (e) {
		throw n = [e], e;
	}
}, t, n = e((() => {
	t = "1.2.3";
})), r, i = e((() => {
	n(), r = class e extends Error {
		constructor(n, r = {}) {
			let i = r.cause instanceof e ? r.cause.details : r.cause?.message ? r.cause.message : r.details, a = r.cause instanceof e && r.cause.docsPath || r.docsPath, o = [
				n || "An error occurred.",
				"",
				...r.metaMessages ? [...r.metaMessages, ""] : [],
				...a ? [`Docs: https://abitype.dev${a}`] : [],
				...i ? [`Details: ${i}`] : [],
				`Version: abitype@${t}`
			].join("\n");
			super(o), Object.defineProperty(this, "details", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "docsPath", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "metaMessages", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "shortMessage", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "name", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "AbiTypeError"
			}), r.cause && (this.cause = r.cause), this.details = i, this.docsPath = a, this.metaMessages = r.metaMessages, this.shortMessage = n;
		}
	};
}));
//#endregion
//#region node_modules/abitype/dist/esm/regex.js
function a(e, t) {
	return e.exec(t)?.groups;
}
var o, s, c, l = e((() => {
	o = /^bytes([1-9]|1[0-9]|2[0-9]|3[0-2])?$/, s = /^u?int(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?$/, c = /^\(.+?\).*?$/;
}));
//#endregion
//#region node_modules/abitype/dist/esm/human-readable/formatAbiParameter.js
function u(e) {
	let t = e.type;
	if (d.test(e.type) && "components" in e) {
		t = "(";
		let n = e.components.length;
		for (let r = 0; r < n; r++) {
			let i = e.components[r];
			t += u(i), r < n - 1 && (t += ", ");
		}
		let r = a(d, e.type);
		return t += `)${r?.array || ""}`, u({
			...e,
			type: t
		});
	}
	return "indexed" in e && e.indexed && (t = `${t} indexed`), e.name ? `${t} ${e.name}` : t;
}
var d, f = e((() => {
	l(), d = /^tuple(?<array>(\[(\d*)\])*)$/;
}));
//#endregion
//#region node_modules/abitype/dist/esm/human-readable/formatAbiParameters.js
function p(e) {
	let t = "", n = e.length;
	for (let r = 0; r < n; r++) {
		let i = e[r];
		t += u(i), r !== n - 1 && (t += ", ");
	}
	return t;
}
var m = e((() => {
	f();
}));
//#endregion
//#region node_modules/abitype/dist/esm/human-readable/formatAbiItem.js
function ee(e) {
	return e.type === "function" ? `function ${e.name}(${p(e.inputs)})${e.stateMutability && e.stateMutability !== "nonpayable" ? ` ${e.stateMutability}` : ""}${e.outputs?.length ? ` returns (${p(e.outputs)})` : ""}` : e.type === "event" ? `event ${e.name}(${p(e.inputs)})` : e.type === "error" ? `error ${e.name}(${p(e.inputs)})` : e.type === "constructor" ? `constructor(${p(e.inputs)})${e.stateMutability === "payable" ? " payable" : ""}` : e.type === "fallback" ? `fallback() external${e.stateMutability === "payable" ? " payable" : ""}` : "receive() external payable";
}
var te = e((() => {
	m();
}));
//#endregion
//#region node_modules/abitype/dist/esm/human-readable/runtime/signatures.js
function ne(e) {
	return he.test(e);
}
function re(e) {
	return a(he, e);
}
function ie(e) {
	return ge.test(e);
}
function ae(e) {
	return a(ge, e);
}
function oe(e) {
	return _e.test(e);
}
function se(e) {
	return a(_e, e);
}
function ce(e) {
	return ve.test(e);
}
function le(e) {
	return a(ve, e);
}
function ue(e) {
	return ye.test(e);
}
function de(e) {
	return a(ye, e);
}
function fe(e) {
	return be.test(e);
}
function pe(e) {
	return a(be, e);
}
function me(e) {
	return xe.test(e);
}
var he, ge, _e, ve, ye, be, xe, Se, h, g = e((() => {
	l(), he = /^error (?<name>[a-zA-Z$_][a-zA-Z0-9$_]*)\((?<parameters>.*?)\)$/, ge = /^event (?<name>[a-zA-Z$_][a-zA-Z0-9$_]*)\((?<parameters>.*?)\)$/, _e = /^function (?<name>[a-zA-Z$_][a-zA-Z0-9$_]*)\((?<parameters>.*?)\)(?: (?<scope>external|public{1}))?(?: (?<stateMutability>pure|view|nonpayable|payable{1}))?(?: returns\s?\((?<returns>.*?)\))?$/, ve = /^struct (?<name>[a-zA-Z$_][a-zA-Z0-9$_]*) \{(?<properties>.*?)\}$/, ye = /^constructor\((?<parameters>.*?)\)(?:\s(?<stateMutability>payable{1}))?$/, be = /^fallback\(\) external(?:\s(?<stateMutability>payable{1}))?$/, xe = /^receive\(\) external payable$/, Se = /* @__PURE__ */ new Set(["indexed"]), h = /* @__PURE__ */ new Set([
		"calldata",
		"memory",
		"storage"
	]);
})), Ce, we, Te = e((() => {
	i(), Ce = class extends r {
		constructor({ type: e }) {
			super("Unknown type.", { metaMessages: [`Type "${e}" is not a valid ABI type. Perhaps you forgot to include a struct signature?`] }), Object.defineProperty(this, "name", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "UnknownTypeError"
			});
		}
	}, we = class extends r {
		constructor({ type: e }) {
			super("Unknown type.", { metaMessages: [`Type "${e}" is not a valid ABI type.`] }), Object.defineProperty(this, "name", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "UnknownSolidityTypeError"
			});
		}
	};
})), Ee, De, Oe, ke, Ae, je = e((() => {
	i(), Ee = class extends r {
		constructor({ param: e }) {
			super("Invalid ABI parameter.", { details: e }), Object.defineProperty(this, "name", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "InvalidParameterError"
			});
		}
	}, De = class extends r {
		constructor({ param: e, name: t }) {
			super("Invalid ABI parameter.", {
				details: e,
				metaMessages: [`"${t}" is a protected Solidity keyword. More info: https://docs.soliditylang.org/en/latest/cheatsheet.html`]
			}), Object.defineProperty(this, "name", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "SolidityProtectedKeywordError"
			});
		}
	}, Oe = class extends r {
		constructor({ param: e, type: t, modifier: n }) {
			super("Invalid ABI parameter.", {
				details: e,
				metaMessages: [`Modifier "${n}" not allowed${t ? ` in "${t}" type` : ""}.`]
			}), Object.defineProperty(this, "name", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "InvalidModifierError"
			});
		}
	}, ke = class extends r {
		constructor({ param: e, type: t, modifier: n }) {
			super("Invalid ABI parameter.", {
				details: e,
				metaMessages: [`Modifier "${n}" not allowed${t ? ` in "${t}" type` : ""}.`, `Data location can only be specified for array, struct, or mapping types, but "${n}" was given.`]
			}), Object.defineProperty(this, "name", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "InvalidFunctionModifierError"
			});
		}
	}, Ae = class extends r {
		constructor({ abiParameter: e }) {
			super("Invalid ABI parameter.", {
				details: JSON.stringify(e, null, 2),
				metaMessages: ["ABI parameter type is invalid."]
			}), Object.defineProperty(this, "name", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "InvalidAbiTypeParameterError"
			});
		}
	};
})), _, Me, Ne, Pe = e((() => {
	i(), _ = class extends r {
		constructor({ signature: e, type: t }) {
			super(`Invalid ${t} signature.`, { details: e }), Object.defineProperty(this, "name", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "InvalidSignatureError"
			});
		}
	}, Me = class extends r {
		constructor({ signature: e }) {
			super("Unknown signature.", { details: e }), Object.defineProperty(this, "name", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "UnknownSignatureError"
			});
		}
	}, Ne = class extends r {
		constructor({ signature: e }) {
			super("Invalid struct signature.", {
				details: e,
				metaMessages: ["No properties exist."]
			}), Object.defineProperty(this, "name", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "InvalidStructSignatureError"
			});
		}
	};
})), Fe, Ie = e((() => {
	i(), Fe = class extends r {
		constructor({ type: e }) {
			super("Circular reference detected.", { metaMessages: [`Struct "${e}" is a circular reference.`] }), Object.defineProperty(this, "name", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "CircularReferenceError"
			});
		}
	};
})), Le, Re = e((() => {
	i(), Le = class extends r {
		constructor({ current: e, depth: t }) {
			super("Unbalanced parentheses.", {
				metaMessages: [`"${e.trim()}" has too many ${t > 0 ? "opening" : "closing"} parentheses.`],
				details: `Depth "${t}"`
			}), Object.defineProperty(this, "name", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "InvalidParenthesisError"
			});
		}
	};
}));
//#endregion
//#region node_modules/abitype/dist/esm/human-readable/runtime/cache.js
function ze(e, t, n) {
	let r = "";
	if (n) for (let e of Object.entries(n)) {
		if (!e) continue;
		let t = "";
		for (let n of e[1]) t += `[${n.type}${n.name ? `:${n.name}` : ""}]`;
		r += `(${e[0]}{${t}})`;
	}
	return t ? `${t}:${e}${r}` : `${e}${r}`;
}
var Be, Ve = e((() => {
	Be = /* @__PURE__ */ new Map([
		["address", { type: "address" }],
		["bool", { type: "bool" }],
		["bytes", { type: "bytes" }],
		["bytes32", { type: "bytes32" }],
		["int", { type: "int256" }],
		["int256", { type: "int256" }],
		["string", { type: "string" }],
		["uint", { type: "uint256" }],
		["uint8", { type: "uint8" }],
		["uint16", { type: "uint16" }],
		["uint24", { type: "uint24" }],
		["uint32", { type: "uint32" }],
		["uint64", { type: "uint64" }],
		["uint96", { type: "uint96" }],
		["uint112", { type: "uint112" }],
		["uint160", { type: "uint160" }],
		["uint192", { type: "uint192" }],
		["uint256", { type: "uint256" }],
		["address owner", {
			type: "address",
			name: "owner"
		}],
		["address to", {
			type: "address",
			name: "to"
		}],
		["bool approved", {
			type: "bool",
			name: "approved"
		}],
		["bytes _data", {
			type: "bytes",
			name: "_data"
		}],
		["bytes data", {
			type: "bytes",
			name: "data"
		}],
		["bytes signature", {
			type: "bytes",
			name: "signature"
		}],
		["bytes32 hash", {
			type: "bytes32",
			name: "hash"
		}],
		["bytes32 r", {
			type: "bytes32",
			name: "r"
		}],
		["bytes32 root", {
			type: "bytes32",
			name: "root"
		}],
		["bytes32 s", {
			type: "bytes32",
			name: "s"
		}],
		["string name", {
			type: "string",
			name: "name"
		}],
		["string symbol", {
			type: "string",
			name: "symbol"
		}],
		["string tokenURI", {
			type: "string",
			name: "tokenURI"
		}],
		["uint tokenId", {
			type: "uint256",
			name: "tokenId"
		}],
		["uint8 v", {
			type: "uint8",
			name: "v"
		}],
		["uint256 balance", {
			type: "uint256",
			name: "balance"
		}],
		["uint256 tokenId", {
			type: "uint256",
			name: "tokenId"
		}],
		["uint256 value", {
			type: "uint256",
			name: "value"
		}],
		["event:address indexed from", {
			type: "address",
			name: "from",
			indexed: !0
		}],
		["event:address indexed to", {
			type: "address",
			name: "to",
			indexed: !0
		}],
		["event:uint indexed tokenId", {
			type: "uint256",
			name: "tokenId",
			indexed: !0
		}],
		["event:uint256 indexed tokenId", {
			type: "uint256",
			name: "tokenId",
			indexed: !0
		}]
	]);
}));
//#endregion
//#region node_modules/abitype/dist/esm/human-readable/runtime/utils.js
function He(e, t = {}) {
	if (oe(e)) return Ue(e, t);
	if (ie(e)) return We(e, t);
	if (ne(e)) return Ge(e, t);
	if (ue(e)) return Ke(e, t);
	if (fe(e)) return qe(e);
	if (me(e)) return {
		type: "receive",
		stateMutability: "payable"
	};
	throw new Me({ signature: e });
}
function Ue(e, t = {}) {
	let n = se(e);
	if (!n) throw new _({
		signature: e,
		type: "function"
	});
	let r = y(n.parameters), i = [], a = r.length;
	for (let e = 0; e < a; e++) i.push(v(r[e], {
		modifiers: h,
		structs: t,
		type: "function"
	}));
	let o = [];
	if (n.returns) {
		let e = y(n.returns), r = e.length;
		for (let n = 0; n < r; n++) o.push(v(e[n], {
			modifiers: h,
			structs: t,
			type: "function"
		}));
	}
	return {
		name: n.name,
		type: "function",
		stateMutability: n.stateMutability ?? "nonpayable",
		inputs: i,
		outputs: o
	};
}
function We(e, t = {}) {
	let n = ae(e);
	if (!n) throw new _({
		signature: e,
		type: "event"
	});
	let r = y(n.parameters), i = [], a = r.length;
	for (let e = 0; e < a; e++) i.push(v(r[e], {
		modifiers: Se,
		structs: t,
		type: "event"
	}));
	return {
		name: n.name,
		type: "event",
		inputs: i
	};
}
function Ge(e, t = {}) {
	let n = re(e);
	if (!n) throw new _({
		signature: e,
		type: "error"
	});
	let r = y(n.parameters), i = [], a = r.length;
	for (let e = 0; e < a; e++) i.push(v(r[e], {
		structs: t,
		type: "error"
	}));
	return {
		name: n.name,
		type: "error",
		inputs: i
	};
}
function Ke(e, t = {}) {
	let n = de(e);
	if (!n) throw new _({
		signature: e,
		type: "constructor"
	});
	let r = y(n.parameters), i = [], a = r.length;
	for (let e = 0; e < a; e++) i.push(v(r[e], {
		structs: t,
		type: "constructor"
	}));
	return {
		type: "constructor",
		stateMutability: n.stateMutability ?? "nonpayable",
		inputs: i
	};
}
function qe(e) {
	let t = pe(e);
	if (!t) throw new _({
		signature: e,
		type: "fallback"
	});
	return {
		type: "fallback",
		stateMutability: t.stateMutability ?? "nonpayable"
	};
}
function v(e, t) {
	let n = ze(e, t?.type, t?.structs);
	if (Be.has(n)) return Be.get(n);
	let r = c.test(e), i = a(r ? Qe : Ze, e);
	if (!i) throw new Ee({ param: e });
	if (i.name && Ye(i.name)) throw new De({
		param: e,
		name: i.name
	});
	let o = i.name ? { name: i.name } : {}, s = i.modifier === "indexed" ? { indexed: !0 } : {}, l = t?.structs ?? {}, u, d = {};
	if (r) {
		u = "tuple";
		let e = y(i.type), t = [], n = e.length;
		for (let r = 0; r < n; r++) t.push(v(e[r], { structs: l }));
		d = { components: t };
	} else if (i.type in l) u = "tuple", d = { components: l[i.type] };
	else if ($e.test(i.type)) u = `${i.type}256`;
	else if (i.type === "address payable") u = "address";
	else if (u = i.type, t?.type !== "struct" && !Je(u)) throw new we({ type: u });
	if (i.modifier) {
		if (!t?.modifiers?.has?.(i.modifier)) throw new Oe({
			param: e,
			type: t?.type,
			modifier: i.modifier
		});
		if (h.has(i.modifier) && !Xe(u, !!i.array)) throw new ke({
			param: e,
			type: t?.type,
			modifier: i.modifier
		});
	}
	let f = {
		type: `${u}${i.array ?? ""}`,
		...o,
		...s,
		...d
	};
	return Be.set(n, f), f;
}
function y(e, t = [], n = "", r = 0) {
	let i = e.trim().length;
	for (let a = 0; a < i; a++) {
		let i = e[a], o = e.slice(a + 1);
		switch (i) {
			case ",": return r === 0 ? y(o, [...t, n.trim()]) : y(o, t, `${n}${i}`, r);
			case "(": return y(o, t, `${n}${i}`, r + 1);
			case ")": return y(o, t, `${n}${i}`, r - 1);
			default: return y(o, t, `${n}${i}`, r);
		}
	}
	if (n === "") return t;
	if (r !== 0) throw new Le({
		current: n,
		depth: r
	});
	return t.push(n.trim()), t;
}
function Je(e) {
	return e === "address" || e === "bool" || e === "function" || e === "string" || o.test(e) || s.test(e);
}
function Ye(e) {
	return e === "address" || e === "bool" || e === "function" || e === "string" || e === "tuple" || o.test(e) || s.test(e) || et.test(e);
}
function Xe(e, t) {
	return t || e === "bytes" || e === "string" || e === "tuple";
}
var Ze, Qe, $e, et, tt = e((() => {
	l(), Te(), je(), Pe(), Re(), Ve(), g(), Ze = /^(?<type>[a-zA-Z$_][a-zA-Z0-9$_]*(?:\spayable)?)(?<array>(?:\[\d*?\])+?)?(?:\s(?<modifier>calldata|indexed|memory|storage{1}))?(?:\s(?<name>[a-zA-Z$_][a-zA-Z0-9$_]*))?$/, Qe = /^\((?<type>.+?)\)(?<array>(?:\[\d*?\])+?)?(?:\s(?<modifier>calldata|indexed|memory|storage{1}))?(?:\s(?<name>[a-zA-Z$_][a-zA-Z0-9$_]*))?$/, $e = /^u?int$/, et = /^(?:after|alias|anonymous|apply|auto|byte|calldata|case|catch|constant|copyof|default|defined|error|event|external|false|final|function|immutable|implements|in|indexed|inline|internal|let|mapping|match|memory|mutable|null|of|override|partial|private|promise|public|pure|reference|relocatable|return|returns|sizeof|static|storage|struct|super|supports|switch|this|true|try|typedef|typeof|var|view|virtual)$/;
}));
//#endregion
//#region node_modules/abitype/dist/esm/human-readable/runtime/structs.js
function nt(e) {
	let t = {}, n = e.length;
	for (let r = 0; r < n; r++) {
		let n = e[r];
		if (!ce(n)) continue;
		let i = le(n);
		if (!i) throw new _({
			signature: n,
			type: "struct"
		});
		let a = i.properties.split(";"), o = [], s = a.length;
		for (let e = 0; e < s; e++) {
			let t = a[e].trim();
			if (!t) continue;
			let n = v(t, { type: "struct" });
			o.push(n);
		}
		if (!o.length) throw new Ne({ signature: n });
		t[i.name] = o;
	}
	let r = {}, i = Object.entries(t), a = i.length;
	for (let e = 0; e < a; e++) {
		let [n, a] = i[e];
		r[n] = rt(a, t);
	}
	return r;
}
function rt(e = [], t = {}, n = /* @__PURE__ */ new Set()) {
	let r = [], i = e.length;
	for (let o = 0; o < i; o++) {
		let i = e[o];
		if (c.test(i.type)) r.push(i);
		else {
			let e = a(it, i.type);
			if (!e?.type) throw new Ae({ abiParameter: i });
			let { array: o, type: s } = e;
			if (s in t) {
				if (n.has(s)) throw new Fe({ type: s });
				r.push({
					...i,
					type: `tuple${o ?? ""}`,
					components: rt(t[s], t, /* @__PURE__ */ new Set([...n, s]))
				});
			} else if (Je(s)) r.push(i);
			else throw new Ce({ type: s });
		}
	}
	return r;
}
var it, at = e((() => {
	l(), Te(), je(), Pe(), Ie(), g(), tt(), it = /^(?<type>[a-zA-Z$_][a-zA-Z0-9$_]*)(?<array>(?:\[\d*?\])+?)?$/;
}));
//#endregion
//#region node_modules/abitype/dist/esm/human-readable/parseAbi.js
function ot(e) {
	let t = nt(e), n = [], r = e.length;
	for (let i = 0; i < r; i++) {
		let r = e[i];
		ce(r) || n.push(He(r, t));
	}
	return n;
}
var st = e((() => {
	g(), at(), tt();
})), ct = e((() => {
	i(), te(), f(), m(), st(), Te(), g(), at(), tt(), je(), Pe(), Re(), Ie();
}));
//#endregion
//#region node_modules/viem/_esm/utils/abi/formatAbiItem.js
function lt(e, { includeName: t = !1 } = {}) {
	if (e.type !== "function" && e.type !== "event" && e.type !== "error") throw new Tt(e.type);
	return `${e.name}(${ut(e.inputs, { includeName: t })})`;
}
function ut(e, { includeName: t = !1 } = {}) {
	return e ? e.map((e) => dt(e, { includeName: t })).join(t ? ", " : ",") : "";
}
function dt(e, { includeName: t }) {
	return e.type.startsWith("tuple") ? `(${ut(e.components, { includeName: t })})${e.type.slice(5)}` : e.type + (t && e.name ? ` ${e.name}` : "");
}
var ft = e((() => {
	T();
}));
//#endregion
//#region node_modules/viem/_esm/utils/data/isHex.js
function b(e, { strict: t = !0 } = {}) {
	return !e || typeof e != "string" ? !1 : t ? /^0x[0-9a-fA-F]*$/.test(e) : e.startsWith("0x");
}
var x = e((() => {}));
//#endregion
//#region node_modules/viem/_esm/utils/data/size.js
function S(e) {
	return b(e, { strict: !1 }) ? Math.ceil((e.length - 2) / 2) : e.length;
}
var pt = e((() => {
	x();
})), mt, ht = e((() => {
	mt = "2.57.1";
}));
//#endregion
//#region node_modules/viem/_esm/errors/base.js
function gt(e, t) {
	return t?.(e) ? e : e && typeof e == "object" && "cause" in e && e.cause !== void 0 ? gt(e.cause, t) : t ? null : e;
}
var _t, C, w = e((() => {
	ht(), _t = {
		getDocsUrl: ({ docsBaseUrl: e, docsPath: t = "", docsSlug: n }) => t ? `${e ?? "https://viem.sh"}${t}${n ? `#${n}` : ""}` : void 0,
		version: `viem@${mt}`
	}, C = class e extends Error {
		constructor(t, n = {}) {
			let r = n.cause instanceof e ? n.cause.details : n.cause?.message ? n.cause.message : n.details, i = n.cause instanceof e && n.cause.docsPath || n.docsPath, a = _t.getDocsUrl?.({
				...n,
				docsPath: i
			}), o = [
				t || "An error occurred.",
				"",
				...n.metaMessages ? [...n.metaMessages, ""] : [],
				...a ? [`Docs: ${a}`] : [],
				...r ? [`Details: ${r}`] : [],
				..._t.version ? [`Version: ${_t.version}`] : []
			].join("\n");
			super(o, n.cause ? { cause: n.cause } : void 0), Object.defineProperty(this, "details", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "docsPath", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "metaMessages", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "shortMessage", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "version", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "name", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "BaseError"
			}), this.details = r, this.docsPath = i, this.metaMessages = n.metaMessages, this.name = n.name ?? this.name, this.shortMessage = t, this.version = mt;
		}
		walk(e) {
			return gt(this, e);
		}
	};
})), vt, yt, bt, xt, St, Ct, wt, Tt, T = e((() => {
	ft(), pt(), w(), vt = class extends C {
		constructor({ expectedLength: e, givenLength: t, type: n }) {
			super([
				`ABI encoding array length mismatch for type ${n}.`,
				`Expected length: ${e}`,
				`Given length: ${t}`
			].join("\n"), { name: "AbiEncodingArrayLengthMismatchError" });
		}
	}, yt = class extends C {
		constructor({ expectedSize: e, value: t }) {
			super(`Size of bytes "${t}" (bytes${S(t)}) does not match expected size (bytes${e}).`, { name: "AbiEncodingBytesSizeMismatchError" });
		}
	}, bt = class extends C {
		constructor({ expectedLength: e, givenLength: t }) {
			super([
				"ABI encoding params/values length mismatch.",
				`Expected length (params): ${e}`,
				`Given length (values): ${t}`
			].join("\n"), { name: "AbiEncodingLengthMismatchError" });
		}
	}, xt = class extends C {
		constructor(e, { docsPath: t } = {}) {
			super([`Function ${e ? `"${e}" ` : ""}not found on ABI.`, "Make sure you are using the correct ABI and that the function exists on it."].join("\n"), {
				docsPath: t,
				name: "AbiFunctionNotFoundError"
			});
		}
	}, St = class extends C {
		constructor(e, t) {
			super("Found ambiguous types in overloaded ABI items.", {
				metaMessages: [
					`\`${e.type}\` in \`${lt(e.abiItem)}\`, and`,
					`\`${t.type}\` in \`${lt(t.abiItem)}\``,
					"",
					"These types encode differently and cannot be distinguished at runtime.",
					"Remove one of the ambiguous items in the ABI."
				],
				name: "AbiItemAmbiguityError"
			});
		}
	}, Ct = class extends C {
		constructor(e, { docsPath: t }) {
			super([`Type "${e}" is not a valid encoding type.`, "Please provide a valid ABI type."].join("\n"), {
				docsPath: t,
				name: "InvalidAbiEncodingType"
			});
		}
	}, wt = class extends C {
		constructor(e) {
			super([`Value "${e}" is not a valid array.`].join("\n"), { name: "InvalidArrayError" });
		}
	}, Tt = class extends C {
		constructor(e) {
			super([`"${e}" is not a valid definition type.`, "Valid types: \"function\", \"event\", \"error\""].join("\n"), { name: "InvalidDefinitionTypeError" });
		}
	};
})), Et, Dt, Ot = e((() => {
	w(), Et = class extends C {
		constructor({ offset: e, position: t, size: n }) {
			super(`Slice ${t === "start" ? "starting" : "ending"} at offset "${e}" is out-of-bounds (size: ${n}).`, { name: "SliceOffsetOutOfBoundsError" });
		}
	}, Dt = class extends C {
		constructor({ size: e, targetSize: t, type: n }) {
			super(`${n.charAt(0).toUpperCase()}${n.slice(1).toLowerCase()} size (${e}) exceeds padding size (${t}).`, { name: "SizeExceedsPaddingSizeError" });
		}
	};
}));
//#endregion
//#region node_modules/viem/_esm/utils/data/pad.js
function E(e, { dir: t, size: n = 32 } = {}) {
	return typeof e == "string" ? D(e, {
		dir: t,
		size: n
	}) : kt(e, {
		dir: t,
		size: n
	});
}
function D(e, { dir: t, size: n = 32 } = {}) {
	if (n === null) return e;
	let r = e.replace("0x", "");
	if (r.length > n * 2) throw new Dt({
		size: Math.ceil(r.length / 2),
		targetSize: n,
		type: "hex"
	});
	return `0x${r[t === "right" ? "padEnd" : "padStart"](n * 2, "0")}`;
}
function kt(e, { dir: t, size: n = 32 } = {}) {
	if (n === null) return e;
	if (e.length > n) throw new Dt({
		size: e.length,
		targetSize: n,
		type: "bytes"
	});
	let r = new Uint8Array(n);
	for (let i = 0; i < n; i++) {
		let a = t === "right";
		r[a ? i : n - i - 1] = e[a ? i : e.length - i - 1];
	}
	return r;
}
var At = e((() => {
	Ot();
})), jt, Mt, Nt = e((() => {
	w(), jt = class extends C {
		constructor({ max: e, min: t, signed: n, size: r, value: i }) {
			super(`Number "${i}" is not in safe ${r ? `${r * 8}-bit ${n ? "signed" : "unsigned"} ` : ""}integer range ${e ? `(${t} to ${e})` : `(above ${t})`}`, { name: "IntegerOutOfRangeError" });
		}
	}, Mt = class extends C {
		constructor({ givenSize: e, maxSize: t }) {
			super(`Size cannot exceed ${t} bytes. Given size: ${e} bytes.`, { name: "SizeOverflowError" });
		}
	};
}));
//#endregion
//#region node_modules/viem/_esm/utils/encoding/fromHex.js
function O(e, { size: t }) {
	if (S(e) > t) throw new Mt({
		givenSize: S(e),
		maxSize: t
	});
}
var Pt = e((() => {
	Nt(), pt();
}));
//#endregion
//#region node_modules/viem/_esm/utils/encoding/toHex.js
function Ft(e, t = {}) {
	return typeof e == "number" || typeof e == "bigint" ? k(e, t) : typeof e == "string" ? Rt(e, t) : typeof e == "boolean" ? It(e, t) : Lt(e, t);
}
function It(e, t = {}) {
	let n = `0x${Number(e)}`;
	return typeof t.size == "number" ? (O(n, { size: t.size }), E(n, { size: t.size })) : n;
}
function Lt(e, t = {}) {
	let n = "";
	for (let t = 0; t < e.length; t++) n += zt[e[t]];
	let r = `0x${n}`;
	return typeof t.size == "number" ? (O(r, { size: t.size }), E(r, {
		dir: "right",
		size: t.size
	})) : r;
}
function k(e, t = {}) {
	let { signed: n, size: r } = t, i = BigInt(e), a;
	r ? a = n ? (1n << BigInt(r) * 8n - 1n) - 1n : 2n ** (BigInt(r) * 8n) - 1n : typeof e == "number" && (a = BigInt(2 ** 53 - 1));
	let o = typeof a == "bigint" && n ? -a - 1n : 0;
	if (a && i > a || i < o) {
		let t = typeof e == "bigint" ? "n" : "";
		throw new jt({
			max: a ? `${a}${t}` : void 0,
			min: `${o}${t}`,
			signed: n,
			size: r,
			value: `${e}${t}`
		});
	}
	let s = `0x${(n && i < 0 ? (1n << BigInt(r * 8)) + BigInt(i) : i).toString(16)}`;
	return r ? E(s, { size: r }) : s;
}
function Rt(e, t = {}) {
	return Lt(Bt.encode(e), t);
}
var zt, Bt, Vt = e((() => {
	Nt(), At(), Pt(), zt = /*#__PURE__*/ Array.from({ length: 256 }, (e, t) => t.toString(16).padStart(2, "0")), Bt = /*#__PURE__*/ new TextEncoder();
}));
//#endregion
//#region node_modules/viem/_esm/utils/encoding/toBytes.js
function Ht(e, t = {}) {
	return typeof e == "number" || typeof e == "bigint" ? Kt(e, t) : typeof e == "boolean" ? Ut(e, t) : b(e) ? Gt(e, t) : qt(e, t);
}
function Ut(e, t = {}) {
	let n = /* @__PURE__ */ new Uint8Array(1);
	return n[0] = Number(e), typeof t.size == "number" ? (O(n, { size: t.size }), E(n, { size: t.size })) : n;
}
function Wt(e) {
	if (e >= A.zero && e <= A.nine) return e - A.zero;
	if (e >= A.A && e <= A.F) return e - (A.A - 10);
	if (e >= A.a && e <= A.f) return e - (A.a - 10);
}
function Gt(e, t = {}) {
	let n = e;
	t.size && (O(n, { size: t.size }), n = E(n, {
		dir: "right",
		size: t.size
	}));
	let r = n.slice(2);
	r.length % 2 && (r = `0${r}`);
	let i = r.length / 2, a = new Uint8Array(i);
	for (let e = 0, t = 0; e < i; e++) {
		let n = Wt(r.charCodeAt(t++)), i = Wt(r.charCodeAt(t++));
		if (n === void 0 || i === void 0) throw new C(`Invalid byte sequence ("${r[t - 2]}${r[t - 1]}" in "${r}").`);
		a[e] = n * 16 + i;
	}
	return a;
}
function Kt(e, t) {
	return Gt(k(e, t));
}
function qt(e, t = {}) {
	let n = Jt.encode(e);
	return typeof t.size == "number" ? (O(n, { size: t.size }), E(n, {
		dir: "right",
		size: t.size
	})) : n;
}
var Jt, A, Yt = e((() => {
	w(), x(), At(), Pt(), Vt(), Jt = /*#__PURE__*/ new TextEncoder(), A = {
		zero: 48,
		nine: 57,
		A: 65,
		F: 70,
		a: 97,
		f: 102
	};
}));
//#endregion
//#region node_modules/@noble/hashes/esm/_u64.js
function Xt(e, t = !1) {
	return t ? {
		h: Number(e & j),
		l: Number(e >> Qt & j)
	} : {
		h: Number(e >> Qt & j) | 0,
		l: Number(e & j) | 0
	};
}
function Zt(e, t = !1) {
	let n = e.length, r = new Uint32Array(n), i = new Uint32Array(n);
	for (let a = 0; a < n; a++) {
		let { h: n, l: o } = Xt(e[a], t);
		[r[a], i[a]] = [n, o];
	}
	return [r, i];
}
var j, Qt, $t, en, tn, nn, rn = e((() => {
	j = /* @__PURE__ */ BigInt(2 ** 32 - 1), Qt = /* @__PURE__ */ BigInt(32), $t = (e, t, n) => e << n | t >>> 32 - n, en = (e, t, n) => t << n | e >>> 32 - n, tn = (e, t, n) => t << n - 32 | e >>> 64 - n, nn = (e, t, n) => e << n - 32 | t >>> 64 - n;
}));
//#endregion
//#region node_modules/@noble/hashes/esm/utils.js
function an(e) {
	return e instanceof Uint8Array || ArrayBuffer.isView(e) && e.constructor.name === "Uint8Array";
}
function on(e) {
	if (!Number.isSafeInteger(e) || e < 0) throw Error("positive integer expected, got " + e);
}
function sn(e, ...t) {
	if (!an(e)) throw Error("Uint8Array expected");
	if (t.length > 0 && !t.includes(e.length)) throw Error("Uint8Array expected of length " + t + ", got length=" + e.length);
}
function cn(e, t = !0) {
	if (e.destroyed) throw Error("Hash instance has been destroyed");
	if (t && e.finished) throw Error("Hash#digest() has already been called");
}
function ln(e, t) {
	sn(e);
	let n = t.outputLen;
	if (e.length < n) throw Error("digestInto() expects output buffer of length at least " + n);
}
function un(e) {
	return new Uint32Array(e.buffer, e.byteOffset, Math.floor(e.byteLength / 4));
}
function dn(...e) {
	for (let t = 0; t < e.length; t++) e[t].fill(0);
}
function fn(e) {
	return e << 24 & 4278190080 | e << 8 & 16711680 | e >>> 8 & 65280 | e >>> 24 & 255;
}
function pn(e) {
	for (let t = 0; t < e.length; t++) e[t] = fn(e[t]);
	return e;
}
function mn(e) {
	if (typeof e != "string") throw Error("string expected");
	return new Uint8Array(new TextEncoder().encode(e));
}
function hn(e) {
	return typeof e == "string" && (e = mn(e)), sn(e), e;
}
function gn(e) {
	let t = (t) => e().update(hn(t)).digest(), n = e();
	return t.outputLen = n.outputLen, t.blockLen = n.blockLen, t.create = () => e(), t;
}
var _n, vn, yn, bn = e((() => {
	_n = new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68, vn = _n ? (e) => e : pn, yn = class {};
}));
//#endregion
//#region node_modules/@noble/hashes/esm/sha3.js
function xn(e, t = 24) {
	let n = /* @__PURE__ */ new Uint32Array(10);
	for (let r = 24 - t; r < 24; r++) {
		for (let t = 0; t < 10; t++) n[t] = e[t] ^ e[t + 10] ^ e[t + 20] ^ e[t + 30] ^ e[t + 40];
		for (let t = 0; t < 10; t += 2) {
			let r = (t + 8) % 10, i = (t + 2) % 10, a = n[i], o = n[i + 1], s = Nn(a, o, 1) ^ n[r], c = Pn(a, o, 1) ^ n[r + 1];
			for (let n = 0; n < 50; n += 10) e[t + n] ^= s, e[t + n + 1] ^= c;
		}
		let t = e[2], i = e[3];
		for (let n = 0; n < 24; n++) {
			let r = On[n], a = Nn(t, i, r), o = Pn(t, i, r), s = Dn[n];
			t = e[s], i = e[s + 1], e[s] = a, e[s + 1] = o;
		}
		for (let t = 0; t < 50; t += 10) {
			for (let r = 0; r < 10; r++) n[r] = e[t + r];
			for (let r = 0; r < 10; r++) e[t + r] ^= ~n[(r + 2) % 10] & n[(r + 4) % 10];
		}
		e[0] ^= jn[r], e[1] ^= Mn[r];
	}
	dn(n);
}
var Sn, M, Cn, wn, Tn, En, Dn, On, kn, An, jn, Mn, Nn, Pn, Fn, In, Ln, Rn = e((() => {
	rn(), bn(), Sn = BigInt(0), M = BigInt(1), Cn = BigInt(2), wn = BigInt(7), Tn = BigInt(256), En = BigInt(113), Dn = [], On = [], kn = [];
	for (let e = 0, t = M, n = 1, r = 0; e < 24; e++) {
		[n, r] = [r, (2 * n + 3 * r) % 5], Dn.push(2 * (5 * r + n)), On.push((e + 1) * (e + 2) / 2 % 64);
		let i = Sn;
		for (let e = 0; e < 7; e++) t = (t << M ^ (t >> wn) * En) % Tn, t & Cn && (i ^= M << (M << /* @__PURE__ */ BigInt(e)) - M);
		kn.push(i);
	}
	An = Zt(kn, !0), jn = An[0], Mn = An[1], Nn = (e, t, n) => n > 32 ? tn(e, t, n) : $t(e, t, n), Pn = (e, t, n) => n > 32 ? nn(e, t, n) : en(e, t, n), Fn = class e extends yn {
		constructor(e, t, n, r = !1, i = 24) {
			if (super(), this.pos = 0, this.posOut = 0, this.finished = !1, this.destroyed = !1, this.enableXOF = !1, this.blockLen = e, this.suffix = t, this.outputLen = n, this.enableXOF = r, this.rounds = i, on(n), !(0 < e && e < 200)) throw Error("only keccak-f1600 function is supported");
			this.state = /* @__PURE__ */ new Uint8Array(200), this.state32 = un(this.state);
		}
		clone() {
			return this._cloneInto();
		}
		keccak() {
			vn(this.state32), xn(this.state32, this.rounds), vn(this.state32), this.posOut = 0, this.pos = 0;
		}
		update(e) {
			cn(this), e = hn(e), sn(e);
			let { blockLen: t, state: n } = this, r = e.length;
			for (let i = 0; i < r;) {
				let a = Math.min(t - this.pos, r - i);
				for (let t = 0; t < a; t++) n[this.pos++] ^= e[i++];
				this.pos === t && this.keccak();
			}
			return this;
		}
		finish() {
			if (this.finished) return;
			this.finished = !0;
			let { state: e, suffix: t, pos: n, blockLen: r } = this;
			e[n] ^= t, t & 128 && n === r - 1 && this.keccak(), e[r - 1] ^= 128, this.keccak();
		}
		writeInto(e) {
			cn(this, !1), sn(e), this.finish();
			let t = this.state, { blockLen: n } = this;
			for (let r = 0, i = e.length; r < i;) {
				this.posOut >= n && this.keccak();
				let a = Math.min(n - this.posOut, i - r);
				e.set(t.subarray(this.posOut, this.posOut + a), r), this.posOut += a, r += a;
			}
			return e;
		}
		xofInto(e) {
			if (!this.enableXOF) throw Error("XOF is not possible for this instance");
			return this.writeInto(e);
		}
		xof(e) {
			return on(e), this.xofInto(new Uint8Array(e));
		}
		digestInto(e) {
			if (ln(e, this), this.finished) throw Error("digest() was already called");
			return this.writeInto(e), this.destroy(), e;
		}
		digest() {
			return this.digestInto(new Uint8Array(this.outputLen));
		}
		destroy() {
			this.destroyed = !0, dn(this.state);
		}
		_cloneInto(t) {
			let { blockLen: n, suffix: r, outputLen: i, rounds: a, enableXOF: o } = this;
			return t ||= new e(n, r, i, o, a), t.state32.set(this.state32), t.pos = this.pos, t.posOut = this.posOut, t.finished = this.finished, t.rounds = a, t.suffix = r, t.outputLen = i, t.enableXOF = o, t.destroyed = this.destroyed, t;
		}
	}, In = (e, t, n) => gn(() => new Fn(t, e, n)), Ln = /* @__PURE__ */ In(1, 136, 32);
}));
//#endregion
//#region node_modules/viem/_esm/utils/hash/keccak256.js
function zn(e, t) {
	let n = t || "hex", r = Ln(b(e, { strict: !1 }) ? Ht(e) : e);
	return n === "bytes" ? r : Ft(r);
}
var Bn = e((() => {
	Rn(), x(), Yt(), Vt();
}));
//#endregion
//#region node_modules/viem/_esm/utils/hash/hashSignature.js
function Vn(e) {
	return Hn(e);
}
var Hn, Un = e((() => {
	Yt(), Bn(), Hn = (e) => zn(Ht(e));
}));
//#endregion
//#region node_modules/viem/_esm/utils/hash/normalizeSignature.js
function Wn(e) {
	let t = !0, n = "", r = 0, i = "", a = !1;
	for (let o = 0; o < e.length; o++) {
		let s = e[o];
		if ([
			"(",
			")",
			","
		].includes(s) && (t = !0), s === "(" && r++, s === ")" && r--, t) {
			if (r === 0) {
				if (s === " " && [
					"event",
					"function",
					""
				].includes(i)) i = "";
				else if (i += s, s === ")") {
					a = !0;
					break;
				}
				continue;
			}
			if (s === " ") {
				e[o - 1] !== "," && n !== "," && n !== ",(" && (n = "", t = !1);
				continue;
			}
			i += s, n += s;
		}
	}
	if (!a) throw new C("Unable to normalize signature.");
	return i;
}
var Gn = e((() => {
	w();
})), Kn, qn = e((() => {
	ct(), Gn(), Kn = (e) => Wn(typeof e == "string" ? e : ee(e));
}));
//#endregion
//#region node_modules/viem/_esm/utils/hash/toSignatureHash.js
function Jn(e) {
	return Vn(Kn(e));
}
var Yn = e((() => {
	Un(), qn();
})), Xn, Zn = e((() => {
	Yn(), Xn = Jn;
})), Qn, $n = e((() => {
	w(), Qn = class extends C {
		constructor({ address: e }) {
			super(`Address "${e}" is invalid.`, {
				metaMessages: ["- Address must be a hex value of 20 bytes (40 hex characters).", "- Address must match its checksum counterpart."],
				name: "InvalidAddressError"
			});
		}
	};
})), er, tr = e((() => {
	er = class extends Map {
		constructor(e) {
			super(), Object.defineProperty(this, "maxSize", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), this.maxSize = e;
		}
		get(e) {
			let t = super.get(e);
			return super.has(e) && (super.delete(e), super.set(e, t)), t;
		}
		set(e, t) {
			if (super.has(e) && super.delete(e), super.set(e, t), this.maxSize && this.size > this.maxSize) {
				let e = super.keys().next().value;
				e !== void 0 && super.delete(e);
			}
			return this;
		}
	};
}));
//#endregion
//#region node_modules/viem/_esm/utils/address/getAddress.js
function nr(e, t) {
	if (rr.has(`${e}.${t}`)) return rr.get(`${e}.${t}`);
	let n = t ? `${t}${e.toLowerCase()}` : e.substring(2).toLowerCase(), r = zn(qt(n), "bytes"), i = (t ? n.substring(`${t}0x`.length) : n).split("");
	for (let e = 0; e < 40; e += 2) r[e >> 1] >> 4 >= 8 && i[e] && (i[e] = i[e].toUpperCase()), (r[e >> 1] & 15) >= 8 && i[e + 1] && (i[e + 1] = i[e + 1].toUpperCase());
	let a = `0x${i.join("")}`;
	return rr.set(`${e}.${t}`, a), a;
}
function N(e, t) {
	if (!ar(e, { strict: !1 })) throw new Qn({ address: e });
	return nr(e, t);
}
var rr, ir = e((() => {
	$n(), Yt(), Bn(), tr(), cr(), rr = /*#__PURE__*/ new er(8192);
}));
//#endregion
//#region node_modules/viem/_esm/utils/address/isAddress.js
function ar(e, t) {
	let { strict: n = !0 } = t ?? {}, r = `${e}.${n}`;
	if (sr.has(r)) return sr.get(r);
	let i = or.test(e) ? e.toLowerCase() === e || !n || nr(e) === e : !1;
	return sr.set(r, i), i;
}
var or, sr, cr = e((() => {
	tr(), ir(), or = /^0x[a-fA-F0-9]{40}$/, sr = /*#__PURE__*/ new er(8192);
}));
//#endregion
//#region node_modules/viem/_esm/utils/data/concat.js
function P(e) {
	return `0x${e.reduce((e, t) => e + t.replace("0x", ""), "")}`;
}
var lr = e((() => {}));
//#endregion
//#region node_modules/viem/_esm/utils/data/slice.js
function ur(e, t, n, { strict: r } = {}) {
	return b(e, { strict: !1 }) ? mr(e, t, n, { strict: r }) : pr(e, t, n, { strict: r });
}
function dr(e, t) {
	if (typeof t == "number" && t > 0 && t > S(e) - 1) throw new Et({
		offset: t,
		position: "start",
		size: S(e)
	});
}
function fr(e, t, n) {
	if (typeof t == "number" && typeof n == "number" && S(e) !== n - t) throw new Et({
		offset: n,
		position: "end",
		size: S(e)
	});
}
function pr(e, t, n, { strict: r } = {}) {
	dr(e, t);
	let i = e.slice(t, n);
	return r && fr(i, t, n), i;
}
function mr(e, t, n, { strict: r } = {}) {
	dr(e, t);
	let i = `0x${e.replace("0x", "").slice((t ?? 0) * 2, (n ?? e.length) * 2)}`;
	return r && fr(i, t, n), i;
}
var hr = e((() => {
	Ot(), x(), pt();
})), gr, _r = e((() => {
	gr = /^(u?int)(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?$/;
}));
//#endregion
//#region node_modules/viem/_esm/utils/abi/encodeAbiParameters.js
function vr(e, t) {
	if (e.length !== t.length) throw new bt({
		expectedLength: e.length,
		givenLength: t.length
	});
	return xr(yr({
		params: e,
		values: t
	}));
}
function yr({ params: e, values: t }) {
	let n = [];
	for (let r = 0; r < e.length; r++) n.push(br({
		param: e[r],
		value: t[r]
	}));
	return n;
}
function br({ param: e, value: t }) {
	let n = kr(e.type);
	if (n) {
		let [r, i] = n;
		return Cr(t, {
			length: r,
			param: {
				...e,
				type: i
			}
		});
	}
	if (e.type === "tuple") return Or(t, { param: e });
	if (e.type === "address") return Sr(t);
	if (e.type === "bool") return Tr(t);
	if (e.type.startsWith("uint") || e.type.startsWith("int")) {
		let n = e.type.startsWith("int"), [, , r = "256"] = gr.exec(e.type) ?? [];
		return Er(t, {
			signed: n,
			size: Number(r)
		});
	}
	if (e.type.startsWith("bytes")) return wr(t, { param: e });
	if (e.type === "string") return Dr(t);
	throw new Ct(e.type, { docsPath: "/docs/contract/encodeAbiParameters" });
}
function xr(e) {
	let t = 0;
	for (let n = 0; n < e.length; n++) {
		let { dynamic: r, encoded: i } = e[n];
		t += r ? 32 : S(i);
	}
	let n = [], r = [], i = 0;
	for (let a = 0; a < e.length; a++) {
		let { dynamic: o, encoded: s } = e[a];
		o ? (n.push(k(t + i, { size: 32 })), r.push(s), i += S(s)) : n.push(s);
	}
	return P([...n, ...r]);
}
function Sr(e) {
	if (!ar(e)) throw new Qn({ address: e });
	return {
		dynamic: !1,
		encoded: D(e.toLowerCase())
	};
}
function Cr(e, { length: t, param: n }) {
	let r = t === null;
	if (!Array.isArray(e)) throw new wt(e);
	if (!r && e.length !== t) throw new vt({
		expectedLength: t,
		givenLength: e.length,
		type: `${n.type}[${t}]`
	});
	let i = e.length === 0 && Ar(n), a = [];
	for (let t = 0; t < e.length; t++) {
		let r = br({
			param: n,
			value: e[t]
		});
		r.dynamic && (i = !0), a.push(r);
	}
	if (r || i) {
		let e = xr(a);
		if (r) return {
			dynamic: !0,
			encoded: P([k(a.length, { size: 32 }), e])
		};
		if (i) return {
			dynamic: !0,
			encoded: e
		};
	}
	return {
		dynamic: !1,
		encoded: P(a.map(({ encoded: e }) => e))
	};
}
function wr(e, { param: t }) {
	let [, n] = t.type.split("bytes"), r = S(e);
	if (!n) {
		let t = e;
		return r % 32 != 0 && (t = D(t, {
			dir: "right",
			size: Math.ceil((e.length - 2) / 2 / 32) * 32
		})), {
			dynamic: !0,
			encoded: P([D(k(r, { size: 32 })), t])
		};
	}
	if (r !== Number.parseInt(n, 10)) throw new yt({
		expectedSize: Number.parseInt(n, 10),
		value: e
	});
	return {
		dynamic: !1,
		encoded: D(e, { dir: "right" })
	};
}
function Tr(e) {
	if (typeof e != "boolean") throw new C(`Invalid boolean value: "${e}" (type: ${typeof e}). Expected: \`true\` or \`false\`.`);
	return {
		dynamic: !1,
		encoded: D(It(e))
	};
}
function Er(e, { signed: t, size: n = 256 }) {
	if (typeof n == "number") {
		let r = 2n ** (BigInt(n) - (t ? 1n : 0n)) - 1n, i = t ? -r - 1n : 0n;
		if (e > r || e < i) throw new jt({
			max: r.toString(),
			min: i.toString(),
			signed: t,
			size: n / 8,
			value: e.toString()
		});
	}
	return {
		dynamic: !1,
		encoded: k(e, {
			size: 32,
			signed: t
		})
	};
}
function Dr(e) {
	let t = Rt(e), n = Math.ceil(S(t) / 32), r = [];
	for (let e = 0; e < n; e++) r.push(D(ur(t, e * 32, (e + 1) * 32), { dir: "right" }));
	return {
		dynamic: !0,
		encoded: P([D(k(S(t), { size: 32 })), ...r])
	};
}
function Or(e, { param: t }) {
	let n = !1, r = [];
	for (let i = 0; i < t.components.length; i++) {
		let a = t.components[i], o = br({
			param: a,
			value: e[Array.isArray(e) ? i : a.name]
		});
		r.push(o), o.dynamic && (n = !0);
	}
	return {
		dynamic: n,
		encoded: n ? xr(r) : P(r.map(({ encoded: e }) => e))
	};
}
function kr(e) {
	let t = e.match(/^(.*)\[(\d+)?\]$/);
	return t ? [t[2] ? Number(t[2]) : null, t[1]] : void 0;
}
function Ar(e) {
	let { type: t } = e;
	if (t === "string" || t === "bytes" || t.endsWith("[]")) return !0;
	if (t === "tuple") return e.components.some(Ar);
	let n = kr(t);
	return n ? Ar({
		...e,
		type: n[1]
	}) : !1;
}
var jr = e((() => {
	T(), $n(), w(), Nt(), cr(), lr(), At(), pt(), hr(), Vt(), _r();
})), Mr, Nr = e((() => {
	hr(), Yn(), Mr = (e) => ur(Jn(e), 0, 4);
}));
//#endregion
//#region node_modules/viem/_esm/utils/abi/getAbiItem.js
function Pr(e) {
	let { abi: t, args: n = [], name: r } = e, i = b(r, { strict: !1 }), a = t.filter((e) => i ? e.type === "function" ? Mr(e) === r : e.type === "event" && Xn(e) === r : "name" in e && e.name === r);
	if (a.length === 0) return;
	if (a.length === 1) return a[0];
	let o;
	for (let e of a) if ("inputs" in e) {
		if (!n || n.length === 0) {
			if (!e.inputs || e.inputs.length === 0) return e;
			continue;
		}
		if (e.inputs && e.inputs.length !== 0 && e.inputs.length === n.length && n.every((t, n) => {
			let r = "inputs" in e && e.inputs[n];
			return r ? Fr(t, r) : !1;
		})) {
			if (o && "inputs" in o && o.inputs) {
				let t = Ir(e.inputs, o.inputs, n);
				if (t) throw new St({
					abiItem: e,
					type: t[0]
				}, {
					abiItem: o,
					type: t[1]
				});
			}
			o = e;
		}
	}
	return o || a[0];
}
function Fr(e, t) {
	let n = typeof e, r = t.type;
	switch (r) {
		case "address": return ar(e, { strict: !1 });
		case "bool": return n === "boolean";
		case "function": return n === "string";
		case "string": return n === "string";
		default: return r === "tuple" && "components" in t ? Object.values(t.components).every((t, r) => n === "object" && Fr(Object.values(e)[r], t)) : /^u?int(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?$/.test(r) ? n === "number" || n === "bigint" : /^bytes([1-9]|1[0-9]|2[0-9]|3[0-2])?$/.test(r) ? n === "string" || e instanceof Uint8Array : /[a-z]+[1-9]{0,3}(\[[0-9]{0,}\])+$/.test(r) ? Array.isArray(e) && e.every((e) => Fr(e, {
			...t,
			type: r.replace(/(\[[0-9]{0,}\])$/, "")
		})) : !1;
	}
}
function Ir(e, t, n) {
	for (let r in e) {
		let i = e[r], a = t[r];
		if (i.type === "tuple" && a.type === "tuple" && "components" in i && "components" in a) return Ir(i.components, a.components, n[r]);
		let o = [i.type, a.type];
		if (o.includes("address") && o.includes("bytes20") || (o.includes("address") && o.includes("string") || o.includes("address") && o.includes("bytes")) && ar(n[r], { strict: !1 })) return o;
	}
}
var Lr = e((() => {
	T(), x(), cr(), Zn(), Nr();
}));
//#endregion
//#region node_modules/viem/_esm/accounts/utils/parseAccount.js
function Rr(e) {
	return typeof e == "string" ? {
		address: e,
		type: "json-rpc"
	} : e;
}
var zr = e((() => {}));
//#endregion
//#region node_modules/viem/_esm/utils/abi/prepareEncodeFunctionData.js
function Br(e) {
	let { abi: t, args: n, functionName: r } = e, i = t[0];
	if (r) {
		let e = Pr({
			abi: t,
			args: n,
			name: r
		});
		if (!e) throw new xt(r, { docsPath: Vr });
		i = e;
	}
	if (i.type !== "function") throw new xt(void 0, { docsPath: Vr });
	return {
		abi: [i],
		functionName: Mr(lt(i))
	};
}
var Vr, Hr = e((() => {
	T(), Nr(), ft(), Lr(), Vr = "/docs/contract/encodeFunctionData";
}));
//#endregion
//#region node_modules/viem/_esm/utils/abi/encodeFunctionData.js
function Ur(e) {
	let { args: t } = e, { abi: n, functionName: r } = e.abi.length === 1 && e.functionName?.startsWith("0x") ? e : Br(e), i = n[0];
	return P([r, ("inputs" in i && i.inputs ? vr(i.inputs, t ?? []) : void 0) ?? "0x"]);
}
var Wr = e((() => {
	lr(), jr(), Hr();
})), Gr, Kr = e((() => {
	Gr = (e, t, n) => JSON.stringify(e, (e, n) => {
		let r = typeof n == "bigint" ? n.toString() : n;
		return typeof t == "function" ? t(e, r) : r;
	}, n);
}));
//#endregion
//#region node_modules/viem/_esm/utils/unit/Value.js
function qr(e, t = 0) {
	if (!Number.isInteger(t) || t < 0) throw new Zr({ decimals: t });
	let n = e.toString(), r = n.startsWith("-");
	r && (n = n.slice(1)), n = n.padStart(t, "0");
	let [i, a] = [n.slice(0, n.length - t), n.slice(n.length - t)];
	return a = a.replace(/(0+)$/, ""), `${r ? "-" : ""}${i || "0"}${a ? `.${a}` : ""}`;
}
function Jr(e, t = 0) {
	if (!Number.isInteger(t) || t < 0) throw new Zr({ decimals: t });
	if (!/^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(e)) throw new Xr({ value: e });
	let [n = "", r = "0"] = e.split("."), i = n.startsWith("-");
	if (i && (n = n.slice(1)), n === "" && (n = "0"), r = r.replace(/(0+)$/, ""), t === 0) r.length > 0 && Number.parseInt(r[0], 10) >= 5 && (n = `${BigInt(n) + 1n}`), r = "";
	else if (r.length > t) {
		let e = r.slice(0, t);
		if (Number.parseInt(r.slice(t, t + 1), 10) >= 5) {
			let i = Yr(e);
			i.length > t ? (r = i.slice(1), n = `${BigInt(n) + 1n}`) : r = i;
		} else r = e;
	} else r = r.padEnd(t, "0");
	return BigInt(`${i ? "-" : ""}${n}${r}`);
}
function Yr(e) {
	let t = e.split(""), n = t.length - 1;
	for (; n >= 0;) {
		let e = Number.parseInt(t[n], 10) + 1;
		if (e < 10) return t[n] = String(e), t.join("");
		t[n] = "0", n--;
	}
	return `1${t.join("")}`;
}
var Xr, Zr, Qr = e((() => {
	Xr = class extends Error {
		constructor({ value: e }) {
			super(`Value \`${e}\` is not a valid decimal number.`), Object.defineProperty(this, "name", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "Value.InvalidDecimalNumberError"
			});
		}
	}, Zr = class extends Error {
		constructor({ decimals: e }) {
			super(`\`decimals\` must be a non-negative integer. Got \`${e}\`.`), Object.defineProperty(this, "name", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "Value.InvalidDecimalsError"
			});
		}
	};
}));
//#endregion
//#region node_modules/viem/_esm/errors/utils.js
function F(e) {
	if (e?.reason) return e.reason;
	if (typeof DOMException == "function") return new DOMException("This operation was aborted", "AbortError");
	let t = /* @__PURE__ */ Error("This operation was aborted");
	return t.name = "AbortError", t;
}
function $r(e) {
	return typeof e == "object" && !!e && "name" in e && e.name === "AbortError";
}
var ei, I = e((() => {
	ei = (e) => {
		try {
			let t = new URL(e);
			return !t.username && !t.password ? e : (t.username = "", t.password = "", t.toString());
		} catch {
			return e;
		}
	};
})), ti, ni, ri = e((() => {
	Kr(), w(), I(), ti = class extends C {
		constructor({ body: e, cause: t, details: n, headers: r, status: i, url: a }) {
			super("HTTP request failed.", {
				cause: t,
				details: n,
				metaMessages: [
					i && `Status: ${i}`,
					`URL: ${ei(a)}`,
					e && `Request body: ${Gr(e)}`
				].filter(Boolean),
				name: "HttpRequestError"
			}), Object.defineProperty(this, "body", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "headers", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "status", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "url", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), this.body = e, this.headers = r, this.status = i, this.url = a;
		}
	}, ni = class extends C {
		constructor({ body: e, error: t, url: n }) {
			super("RPC Request failed.", {
				cause: t,
				details: t.message,
				metaMessages: [`URL: ${ei(n)}`, `Request body: ${Gr(e)}`],
				name: "RpcRequestError"
			}), Object.defineProperty(this, "code", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "data", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), Object.defineProperty(this, "url", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), this.code = t.code, this.data = t.data, this.url = n;
		}
	};
})), ii, L, R, z, B, V, H, U, ai, oi, si, W, G, K, ci, q, li, ui, di, fi, pi, mi, hi, gi, _i, vi, yi, bi, xi, Si, Ci = e((() => {
	w(), ri(), ii = -1, L = class extends C {
		constructor(e, { code: t, docsPath: n, metaMessages: r, name: i, shortMessage: a }) {
			super(a, {
				cause: e,
				docsPath: n,
				metaMessages: r || e?.metaMessages,
				name: i || "RpcError"
			}), Object.defineProperty(this, "code", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), this.name = i || e.name, this.code = e instanceof ni ? e.code : t ?? ii;
		}
	}, R = class extends L {
		constructor(e, t) {
			super(e, t), Object.defineProperty(this, "data", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: void 0
			}), this.data = t.data;
		}
	}, z = class e extends L {
		constructor(t) {
			super(t, {
				code: e.code,
				name: "ParseRpcError",
				shortMessage: "Invalid JSON was received by the server. An error occurred on the server while parsing the JSON text."
			});
		}
	}, Object.defineProperty(z, "code", {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: -32700
	}), B = class e extends L {
		constructor(t) {
			super(t, {
				code: e.code,
				name: "InvalidRequestRpcError",
				shortMessage: "JSON is not a valid request object."
			});
		}
	}, Object.defineProperty(B, "code", {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: -32600
	}), V = class e extends L {
		constructor(t, { method: n } = {}) {
			super(t, {
				code: e.code,
				name: "MethodNotFoundRpcError",
				shortMessage: `The method${n ? ` "${n}"` : ""} does not exist / is not available.`
			});
		}
	}, Object.defineProperty(V, "code", {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: -32601
	}), H = class e extends L {
		constructor(t) {
			super(t, {
				code: e.code,
				name: "InvalidParamsRpcError",
				shortMessage: ["Invalid parameters were provided to the RPC method.", "Double check you have provided the correct parameters."].join("\n")
			});
		}
	}, Object.defineProperty(H, "code", {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: -32602
	}), U = class e extends L {
		constructor(t) {
			super(t, {
				code: e.code,
				name: "InternalRpcError",
				shortMessage: "An internal error was received."
			});
		}
	}, Object.defineProperty(U, "code", {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: -32603
	}), ai = class e extends L {
		constructor(t) {
			super(t, {
				code: e.code,
				name: "InvalidInputRpcError",
				shortMessage: ["Missing or invalid parameters.", "Double check you have provided the correct parameters."].join("\n")
			});
		}
	}, Object.defineProperty(ai, "code", {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: -32e3
	}), oi = class e extends L {
		constructor(t) {
			super(t, {
				code: e.code,
				name: "ResourceNotFoundRpcError",
				shortMessage: "Requested resource not found."
			}), Object.defineProperty(this, "name", {
				enumerable: !0,
				configurable: !0,
				writable: !0,
				value: "ResourceNotFoundRpcError"
			});
		}
	}, Object.defineProperty(oi, "code", {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: -32001
	}), si = class e extends L {
		constructor(t) {
			super(t, {
				code: e.code,
				name: "ResourceUnavailableRpcError",
				shortMessage: "Requested resource not available."
			});
		}
	}, Object.defineProperty(si, "code", {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: -32002
	}), W = class e extends L {
		constructor(t) {
			super(t, {
				code: e.code,
				name: "TransactionRejectedRpcError",
				shortMessage: "Transaction creation failed."
			});
		}
	}, Object.defineProperty(W, "code", {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: -32003
	}), G = class e extends L {
		constructor(t, { method: n } = {}) {
			super(t, {
				code: e.code,
				name: "MethodNotSupportedRpcError",
				shortMessage: `Method${n ? ` "${n}"` : ""} is not supported.`
			});
		}
	}, Object.defineProperty(G, "code", {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: -32004
	}), K = class e extends L {
		constructor(t) {
			super(t, {
				code: e.code,
				name: "LimitExceededRpcError",
				shortMessage: "Request exceeds defined limit."
			});
		}
	}, Object.defineProperty(K, "code", {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: -32005
	}), ci = class e extends L {
		constructor(t) {
			super(t, {
				code: e.code,
				name: "JsonRpcVersionUnsupportedError",
				shortMessage: "Version of JSON-RPC protocol is not supported."
			});
		}
	}, Object.defineProperty(ci, "code", {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: -32006
	}), q = class e extends R {
		constructor(t) {
			super(t, {
				code: e.code,
				name: "UserRejectedRequestError",
				shortMessage: "User rejected the request."
			});
		}
	}, Object.defineProperty(q, "code", {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: 4001
	}), li = class e extends R {
		constructor(t) {
			super(t, {
				code: e.code,
				name: "UnauthorizedProviderError",
				shortMessage: "The requested method and/or account has not been authorized by the user."
			});
		}
	}, Object.defineProperty(li, "code", {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: 4100
	}), ui = class e extends R {
		constructor(t, { method: n } = {}) {
			super(t, {
				code: e.code,
				name: "UnsupportedProviderMethodError",
				shortMessage: `The Provider does not support the requested method${n ? ` " ${n}"` : ""}.`
			});
		}
	}, Object.defineProperty(ui, "code", {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: 4200
	}), di = class e extends R {
		constructor(t) {
			super(t, {
				code: e.code,
				name: "ProviderDisconnectedError",
				shortMessage: "The Provider is disconnected from all chains."
			});
		}
	}, Object.defineProperty(di, "code", {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: 4900
	}), fi = class e extends R {
		constructor(t) {
			super(t, {
				code: e.code,
				name: "ChainDisconnectedError",
				shortMessage: "The Provider is not connected to the requested chain."
			});
		}
	}, Object.defineProperty(fi, "code", {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: 4901
	}), pi = class e extends R {
		constructor(t) {
			super(t, {
				code: e.code,
				name: "SwitchChainError",
				shortMessage: "An error occurred when attempting to switch chain."
			});
		}
	}, Object.defineProperty(pi, "code", {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: 4902
	}), mi = class e extends R {
		constructor(t) {
			super(t, {
				code: e.code,
				name: "UnsupportedNonOptionalCapabilityError",
				shortMessage: "This Wallet does not support a capability that was not marked as optional."
			});
		}
	}, Object.defineProperty(mi, "code", {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: 5700
	}), hi = class e extends R {
		constructor(t) {
			super(t, {
				code: e.code,
				name: "UnsupportedChainIdError",
				shortMessage: "This Wallet does not support the requested chain ID."
			});
		}
	}, Object.defineProperty(hi, "code", {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: 5710
	}), gi = class e extends R {
		constructor(t) {
			super(t, {
				code: e.code,
				name: "DuplicateIdError",
				shortMessage: "There is already a bundle submitted with this ID."
			});
		}
	}, Object.defineProperty(gi, "code", {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: 5720
	}), _i = class e extends R {
		constructor(t) {
			super(t, {
				code: e.code,
				name: "UnknownBundleIdError",
				shortMessage: "This bundle id is unknown / has not been submitted"
			});
		}
	}, Object.defineProperty(_i, "code", {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: 5730
	}), vi = class e extends R {
		constructor(t) {
			super(t, {
				code: e.code,
				name: "BundleTooLargeError",
				shortMessage: "The call bundle is too large for the Wallet to process."
			});
		}
	}, Object.defineProperty(vi, "code", {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: 5740
	}), yi = class e extends R {
		constructor(t) {
			super(t, {
				code: e.code,
				name: "AtomicReadyWalletRejectedUpgradeError",
				shortMessage: "The Wallet can support atomicity after an upgrade, but the user rejected the upgrade."
			});
		}
	}, Object.defineProperty(yi, "code", {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: 5750
	}), bi = class e extends R {
		constructor(t) {
			super(t, {
				code: e.code,
				name: "AtomicityNotSupportedError",
				shortMessage: "The wallet does not support atomic execution but the request requires it."
			});
		}
	}, Object.defineProperty(bi, "code", {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: 5760
	}), xi = class e extends R {
		constructor(t) {
			super(t, {
				code: e.code,
				name: "WalletConnectSessionSettlementError",
				shortMessage: "WalletConnect session settlement failed."
			});
		}
	}, Object.defineProperty(xi, "code", {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: 7e3
	}), Si = class extends L {
		constructor(e) {
			super(e, {
				name: "UnknownRpcError",
				shortMessage: "An unknown RPC error occurred."
			});
		}
	};
}));
//#endregion
//#region node_modules/viem/_esm/utils/wait.js
I();
async function wi(e, { signal: t } = {}) {
	return new Promise((n, r) => {
		if (t?.aborted) {
			r(F(t));
			return;
		}
		let i = () => t?.removeEventListener("abort", o), a = setTimeout(() => {
			i(), n();
		}, e), o = () => {
			clearTimeout(a), i(), r(F(t));
		};
		t?.addEventListener("abort", o, { once: !0 });
	});
}
//#endregion
//#region node_modules/viem/_esm/errors/account.js
w();
var Ti = class extends C {
	constructor({ docsPath: e } = {}) {
		super(["Could not find an Account to execute with this Action.", "Please provide an Account with the `account` argument on the Action, or by supplying an `account` to the Client."].join("\n"), {
			docsPath: e,
			docsSlug: "account",
			name: "AccountNotFoundError"
		});
	}
};
//#endregion
//#region node_modules/viem/_esm/utils/promise/withRetry.js
I();
function Ei(e, { delay: t = 100, retryCount: n = 2, shouldRetry: r = () => !0, signal: i } = {}) {
	return new Promise((a, o) => {
		let s = async ({ count: c = 0 } = {}) => {
			if (i?.aborted) {
				o(F(i));
				return;
			}
			let l = async ({ error: e }) => {
				let n = typeof t == "function" ? t({
					count: c,
					error: e
				}) : t;
				if (n) try {
					await wi(n, { signal: i });
				} catch (e) {
					o(e);
					return;
				}
				return s({ count: c + 1 });
			};
			try {
				a(await e());
			} catch (e) {
				if (i?.aborted) {
					o(F(i));
					return;
				}
				if ($r(e)) {
					o(e);
					return;
				}
				if (c < n && await r({
					count: c,
					error: e
				})) return l({ error: e });
				o(e);
			}
		};
		s().catch(o);
	});
}
//#endregion
//#region node_modules/viem/_esm/utils/uid.js
var Di = 256, Oi = Di, ki;
function Ai(e = 11) {
	if (!ki || Oi + e > Di * 2) {
		ki = "", Oi = 0;
		for (let e = 0; e < Di; e++) ki += (256 + Math.random() * 256 | 0).toString(16).substring(1);
	}
	return ki.substring(Oi, Oi++ + e);
}
//#endregion
//#region node_modules/viem/_esm/clients/createClient.js
zr();
function ji(e) {
	let { batch: t, chain: n, ccipRead: r, dataSuffix: i, key: a = "base", name: o = "Base Client", tokens: s, type: c = "base" } = e, l = e.experimental_blockTag ?? (typeof n?.experimental_preconfirmationTime == "number" ? "pending" : void 0), u = n?.blockTime ?? 12e3, d = Math.min(Math.max(Math.floor(u / 2), 500), 4e3), f = e.pollingInterval ?? d, p = e.cacheTime ?? f, m = e.account ? Rr(e.account) : void 0, { config: ee, request: te, value: ne } = e.transport({
		account: m,
		chain: n,
		pollingInterval: f
	}), re = {
		account: m,
		batch: t,
		cacheTime: p,
		ccipRead: r,
		chain: n,
		dataSuffix: i,
		key: a,
		name: o,
		pollingInterval: f,
		request: te,
		tokens: s,
		transport: {
			...ee,
			...ne
		},
		type: c,
		uid: Ai(),
		...l ? { experimental_blockTag: l } : {}
	};
	function ie(e) {
		return (t) => {
			let n = t(e);
			for (let e in re) delete n[e];
			let r = {
				...e,
				...n
			};
			for (let t in n) {
				let i = e[t], a = n[t];
				Mi(i) && Mi(a) && (r[t] = {
					...i,
					...a
				});
			}
			return Object.assign(r, { extend: ie(r) });
		};
	}
	return Object.assign(re, { extend: ie(re) });
}
function Mi(e) {
	if (typeof e != "object" || !e) return !1;
	let t = Object.getPrototypeOf(e);
	return t === Object.prototype || t === null;
}
//#endregion
//#region node_modules/viem/_esm/utils/promise/withDedupe.js
tr();
var Ni = /*#__PURE__*/ new er(8192);
function Pi(e, { enabled: t = !0, id: n }) {
	if (!t || !n) return e();
	if (Ni.get(n)) return Ni.get(n);
	let r = e().finally(() => Ni.delete(n));
	return Ni.set(n, r), r;
}
w(), ri(), Ci(), I(), Kr();
function Fi(e, t = {}) {
	return async (n, r = {}) => {
		let { dedupe: i = !1, methods: a, retryDelay: o = 150, retryCount: s = 3, signal: c, uid: l } = {
			...t,
			...r
		}, { method: u } = n;
		if (a?.exclude?.includes(u) || a?.include && !a.include.includes(u)) throw new G(/* @__PURE__ */ Error("method not supported"), { method: u });
		if (c?.aborted) throw F(c);
		return Pi(() => Ei(async () => {
			try {
				return await e(n, c ? { signal: c } : void 0);
			} catch (e) {
				if (c?.aborted) throw F(c);
				if ($r(e)) throw e;
				let t = e;
				switch (t.code) {
					case z.code: throw new z(t);
					case B.code: throw new B(t);
					case V.code: throw new V(t, { method: n.method });
					case H.code: throw new H(t);
					case U.code: throw new U(t);
					case ai.code: throw new ai(t);
					case oi.code: throw new oi(t);
					case si.code: throw new si(t);
					case W.code: throw new W(t);
					case G.code: throw new G(t, { method: n.method });
					case K.code: throw new K(t);
					case ci.code: throw new ci(t);
					case q.code: throw new q(t);
					case li.code: throw new li(t);
					case ui.code: throw new ui(t);
					case di.code: throw new di(t);
					case fi.code: throw new fi(t);
					case pi.code: throw new pi(t);
					case mi.code: throw new mi(t);
					case hi.code: throw new hi(t);
					case gi.code: throw new gi(t);
					case _i.code: throw new _i(t);
					case vi.code: throw new vi(t);
					case yi.code: throw new yi(t);
					case bi.code: throw new bi(t);
					case 5e3: throw new q(t);
					case xi.code: throw new xi(t);
					default: throw e instanceof C ? e : new Si(t);
				}
			}
		}, {
			delay: ({ count: e, error: t }) => {
				if (t && t instanceof ti) {
					let e = t?.headers?.get("Retry-After");
					if (e?.match(/\d/)) return Number.parseInt(e, 10) * 1e3;
				}
				return ~~(1 << e) * o;
			},
			retryCount: s,
			signal: c,
			shouldRetry: ({ error: e }) => Ii(e)
		}), {
			enabled: i,
			id: i ? Li(`${l}.${Gr(n)}`) : void 0
		});
	};
}
function Ii(e) {
	return $r(e) ? !1 : "code" in e && typeof e.code == "number" ? e.code === -1 || e.code === K.code || e.code === U.code || e.code === 429 || e.code === -32007 : e instanceof ti && e.status ? e.status === 403 || e.status === 408 || e.status === 413 || e.status === 429 || e.status === 500 || e.status === 502 || e.status === 503 || e.status === 504 : !0;
}
function Li(e, t = 0) {
	let n = 3735928559 ^ t, r = 1103547991 ^ t;
	for (let t = 0; t < e.length; t++) {
		let i = e.charCodeAt(t);
		n = Math.imul(n ^ i, 2654435761), r = Math.imul(r ^ i, 1597334677);
	}
	return n = Math.imul(n ^ n >>> 16, 2246822507), n ^= Math.imul(r ^ r >>> 16, 3266489909), r = Math.imul(r ^ r >>> 16, 2246822507), r ^= Math.imul(n ^ n >>> 16, 3266489909), (4294967296 * (2097151 & r) + (n >>> 0)).toString(36);
}
//#endregion
//#region node_modules/viem/_esm/utils/unit/formatUnits.js
Qr();
function Ri(e, t) {
	return qr(e, t);
}
//#endregion
//#region node_modules/viem/_esm/utils/unit/parseUnits.js
Qr();
function zi(e, t) {
	return Jr(e, t);
}
zr(), Vt();
async function Bi(e, { account: t = e.account, message: n }) {
	if (!t) throw new Ti({ docsPath: "/docs/actions/wallet/signMessage" });
	let r = Rr(t);
	if (r.signMessage) return r.signMessage({ message: n });
	let i = typeof n == "string" ? Rt(n) : n.raw instanceof Uint8Array ? Ft(n.raw) : n.raw;
	return e.request({
		method: "personal_sign",
		params: [i, r.address]
	}, { retryCount: 0 });
}
//#endregion
//#region node_modules/viem/_esm/clients/transports/createTransport.js
function Vi({ key: e, methods: t, name: n, request: r, retryCount: i = 3, retryDelay: a = 150, timeout: o, type: s }, c) {
	let l = Ai();
	return {
		config: {
			key: e,
			methods: t,
			name: n,
			request: r,
			retryCount: i,
			retryDelay: a,
			timeout: o,
			type: s
		},
		request: Fi(r, {
			methods: t,
			retryCount: i,
			retryDelay: a,
			uid: l
		}),
		value: c
	};
}
//#endregion
//#region node_modules/viem/_esm/clients/transports/custom.js
function Hi(e, t = {}) {
	let { key: n = "custom", methods: r, name: i = "Custom Provider", retryDelay: a } = t;
	return ({ retryCount: o }) => Vi({
		key: n,
		methods: r,
		name: i,
		request: e.request.bind(e),
		retryCount: t.retryCount ?? o,
		retryDelay: a,
		type: "custom"
	});
}
//#endregion
//#region cp30-backend/integrations/wallet/escrow-abi.mjs
var Ui = [
	{
		type: "function",
		name: "fund",
		inputs: [{
			name: "quote",
			type: "tuple",
			internalType: "struct StoreEscrow.FundingQuote",
			components: [
				{
					name: "quoteId",
					type: "bytes32",
					internalType: "bytes32"
				},
				{
					name: "payer",
					type: "address",
					internalType: "address"
				},
				{
					name: "mealId",
					type: "bytes32",
					internalType: "bytes32"
				},
				{
					name: "currentVersion",
					type: "uint256",
					internalType: "uint256"
				},
				{
					name: "termsHash",
					type: "bytes32",
					internalType: "bytes32"
				},
				{
					name: "quantity",
					type: "uint256",
					internalType: "uint256"
				},
				{
					name: "unitPrice",
					type: "uint256",
					internalType: "uint256"
				},
				{
					name: "amount",
					type: "uint256",
					internalType: "uint256"
				},
				{
					name: "deadline",
					type: "uint256",
					internalType: "uint256"
				}
			]
		}, {
			name: "signature",
			type: "bytes",
			internalType: "bytes"
		}],
		outputs: [{
			name: "batchId",
			type: "bytes32",
			internalType: "bytes32"
		}],
		stateMutability: "nonpayable"
	},
	{
		type: "function",
		name: "getAccounting",
		inputs: [],
		outputs: [{
			name: "",
			type: "tuple",
			internalType: "struct StoreEscrow.Accounting",
			components: [
				{
					name: "fundedUnits",
					type: "uint256",
					internalType: "uint256"
				},
				{
					name: "fundedAmount",
					type: "uint256",
					internalType: "uint256"
				},
				{
					name: "counts",
					type: "uint256[5]",
					internalType: "uint256[5]"
				},
				{
					name: "amounts",
					type: "uint256[5]",
					internalType: "uint256[5]"
				},
				{
					name: "liability",
					type: "uint256",
					internalType: "uint256"
				}
			]
		}],
		stateMutability: "view"
	},
	{
		type: "function",
		name: "getBatch",
		inputs: [{
			name: "batchId",
			type: "bytes32",
			internalType: "bytes32"
		}],
		outputs: [{
			name: "",
			type: "tuple",
			internalType: "struct StoreEscrow.Batch",
			components: [
				{
					name: "payer",
					type: "address",
					internalType: "address"
				},
				{
					name: "mealId",
					type: "bytes32",
					internalType: "bytes32"
				},
				{
					name: "version",
					type: "uint256",
					internalType: "uint256"
				},
				{
					name: "termsHash",
					type: "bytes32",
					internalType: "bytes32"
				},
				{
					name: "unitPrice",
					type: "uint256",
					internalType: "uint256"
				},
				{
					name: "quantity",
					type: "uint256",
					internalType: "uint256"
				},
				{
					name: "firstUnit",
					type: "uint256",
					internalType: "uint256"
				},
				{
					name: "refundedMask",
					type: "uint16",
					internalType: "uint16"
				}
			]
		}],
		stateMutability: "view"
	},
	{
		type: "function",
		name: "getOperation",
		inputs: [{
			name: "opId",
			type: "bytes32",
			internalType: "bytes32"
		}],
		outputs: [{
			name: "",
			type: "tuple",
			internalType: "struct StoreEscrow.Operation",
			components: [
				{
					name: "kind",
					type: "uint8",
					internalType: "uint8"
				},
				{
					name: "caller",
					type: "address",
					internalType: "address"
				},
				{
					name: "payloadHash",
					type: "bytes32",
					internalType: "bytes32"
				},
				{
					name: "result",
					type: "bytes32",
					internalType: "bytes32"
				},
				{
					name: "executedAt",
					type: "uint256",
					internalType: "uint256"
				}
			]
		}],
		stateMutability: "view"
	},
	{
		type: "function",
		name: "getUnit",
		inputs: [{
			name: "seq",
			type: "uint8",
			internalType: "uint8"
		}],
		outputs: [{
			name: "",
			type: "tuple",
			internalType: "struct StoreEscrow.Unit",
			components: [
				{
					name: "batchId",
					type: "bytes32",
					internalType: "bytes32"
				},
				{
					name: "localIndex",
					type: "uint8",
					internalType: "uint8"
				},
				{
					name: "payer",
					type: "address",
					internalType: "address"
				},
				{
					name: "mealId",
					type: "bytes32",
					internalType: "bytes32"
				},
				{
					name: "version",
					type: "uint256",
					internalType: "uint256"
				},
				{
					name: "termsHash",
					type: "bytes32",
					internalType: "bytes32"
				},
				{
					name: "unitPrice",
					type: "uint256",
					internalType: "uint256"
				},
				{
					name: "bucket",
					type: "uint8",
					internalType: "enum StoreEscrow.Bucket"
				},
				{
					name: "generation",
					type: "uint256",
					internalType: "uint256"
				},
				{
					name: "voucherId",
					type: "bytes32",
					internalType: "bytes32"
				}
			]
		}],
		stateMutability: "view"
	},
	{
		type: "function",
		name: "getVoucher",
		inputs: [{
			name: "voucherId",
			type: "bytes32",
			internalType: "bytes32"
		}],
		outputs: [{
			name: "",
			type: "tuple",
			internalType: "struct StoreEscrow.Voucher",
			components: [
				{
					name: "unitSeq",
					type: "uint8",
					internalType: "uint8"
				},
				{
					name: "generation",
					type: "uint256",
					internalType: "uint256"
				},
				{
					name: "termsHash",
					type: "bytes32",
					internalType: "bytes32"
				},
				{
					name: "issuedAt",
					type: "uint256",
					internalType: "uint256"
				},
				{
					name: "expiresAt",
					type: "uint256",
					internalType: "uint256"
				},
				{
					name: "issuer",
					type: "address",
					internalType: "address"
				},
				{
					name: "lockId",
					type: "bytes32",
					internalType: "bytes32"
				},
				{
					name: "lockedAt",
					type: "uint256",
					internalType: "uint256"
				},
				{
					name: "operator",
					type: "address",
					internalType: "address"
				},
				{
					name: "processor",
					type: "address",
					internalType: "address"
				},
				{
					name: "markerId",
					type: "bytes32",
					internalType: "bytes32"
				},
				{
					name: "handoverRecordedAt",
					type: "uint256",
					internalType: "uint256"
				},
				{
					name: "handoverBlock",
					type: "uint256",
					internalType: "uint256"
				},
				{
					name: "reportId",
					type: "bytes32",
					internalType: "bytes32"
				},
				{
					name: "settleId",
					type: "bytes32",
					internalType: "bytes32"
				},
				{
					name: "expired",
					type: "bool",
					internalType: "bool"
				}
			]
		}],
		stateMutability: "view"
	},
	{
		type: "function",
		name: "settle",
		inputs: [
			{
				name: "opId",
				type: "bytes32",
				internalType: "bytes32"
			},
			{
				name: "voucherId",
				type: "bytes32",
				internalType: "bytes32"
			},
			{
				name: "generation",
				type: "uint256",
				internalType: "uint256"
			}
		],
		outputs: [{
			name: "amount",
			type: "uint256",
			internalType: "uint256"
		}],
		stateMutability: "nonpayable"
	},
	{
		type: "event",
		name: "ControlChanged",
		inputs: [
			{
				name: "kind",
				type: "uint8",
				indexed: !1,
				internalType: "uint8"
			},
			{
				name: "mealId",
				type: "bytes32",
				indexed: !1,
				internalType: "bytes32"
			},
			{
				name: "value",
				type: "bool",
				indexed: !1,
				internalType: "bool"
			},
			{
				name: "revision",
				type: "uint256",
				indexed: !1,
				internalType: "uint256"
			}
		],
		anonymous: !1
	},
	{
		type: "event",
		name: "EIP712DomainChanged",
		inputs: [],
		anonymous: !1
	},
	{
		type: "event",
		name: "Expired",
		inputs: [
			{
				name: "voucherId",
				type: "bytes32",
				indexed: !0,
				internalType: "bytes32"
			},
			{
				name: "unitSeq",
				type: "uint8",
				indexed: !1,
				internalType: "uint8"
			},
			{
				name: "generation",
				type: "uint256",
				indexed: !1,
				internalType: "uint256"
			}
		],
		anonymous: !1
	},
	{
		type: "event",
		name: "Funded",
		inputs: [
			{
				name: "quoteId",
				type: "bytes32",
				indexed: !0,
				internalType: "bytes32"
			},
			{
				name: "batchId",
				type: "bytes32",
				indexed: !0,
				internalType: "bytes32"
			},
			{
				name: "payer",
				type: "address",
				indexed: !0,
				internalType: "address"
			},
			{
				name: "mealId",
				type: "bytes32",
				indexed: !1,
				internalType: "bytes32"
			},
			{
				name: "version",
				type: "uint256",
				indexed: !1,
				internalType: "uint256"
			},
			{
				name: "termsHash",
				type: "bytes32",
				indexed: !1,
				internalType: "bytes32"
			},
			{
				name: "unitPrice",
				type: "uint256",
				indexed: !1,
				internalType: "uint256"
			},
			{
				name: "quantity",
				type: "uint256",
				indexed: !1,
				internalType: "uint256"
			},
			{
				name: "firstUnit",
				type: "uint256",
				indexed: !1,
				internalType: "uint256"
			},
			{
				name: "amount",
				type: "uint256",
				indexed: !1,
				internalType: "uint256"
			}
		],
		anonymous: !1
	},
	{
		type: "event",
		name: "HandoverMarked",
		inputs: [
			{
				name: "voucherId",
				type: "bytes32",
				indexed: !0,
				internalType: "bytes32"
			},
			{
				name: "markerId",
				type: "bytes32",
				indexed: !1,
				internalType: "bytes32"
			},
			{
				name: "lockId",
				type: "bytes32",
				indexed: !1,
				internalType: "bytes32"
			},
			{
				name: "generation",
				type: "uint256",
				indexed: !1,
				internalType: "uint256"
			},
			{
				name: "at",
				type: "uint256",
				indexed: !1,
				internalType: "uint256"
			},
			{
				name: "blockNumber",
				type: "uint256",
				indexed: !1,
				internalType: "uint256"
			}
		],
		anonymous: !1
	},
	{
		type: "event",
		name: "Issued",
		inputs: [
			{
				name: "voucherId",
				type: "bytes32",
				indexed: !0,
				internalType: "bytes32"
			},
			{
				name: "unitSeq",
				type: "uint8",
				indexed: !1,
				internalType: "uint8"
			},
			{
				name: "generation",
				type: "uint256",
				indexed: !1,
				internalType: "uint256"
			},
			{
				name: "termsHash",
				type: "bytes32",
				indexed: !1,
				internalType: "bytes32"
			},
			{
				name: "issuedAt",
				type: "uint256",
				indexed: !1,
				internalType: "uint256"
			},
			{
				name: "expiresAt",
				type: "uint256",
				indexed: !1,
				internalType: "uint256"
			}
		],
		anonymous: !1
	},
	{
		type: "event",
		name: "Locked",
		inputs: [
			{
				name: "voucherId",
				type: "bytes32",
				indexed: !0,
				internalType: "bytes32"
			},
			{
				name: "lockId",
				type: "bytes32",
				indexed: !1,
				internalType: "bytes32"
			},
			{
				name: "generation",
				type: "uint256",
				indexed: !1,
				internalType: "uint256"
			},
			{
				name: "at",
				type: "uint256",
				indexed: !1,
				internalType: "uint256"
			},
			{
				name: "operator",
				type: "address",
				indexed: !1,
				internalType: "address"
			},
			{
				name: "processor",
				type: "address",
				indexed: !1,
				internalType: "address"
			}
		],
		anonymous: !1
	},
	{
		type: "event",
		name: "OperationExecuted",
		inputs: [
			{
				name: "opId",
				type: "bytes32",
				indexed: !0,
				internalType: "bytes32"
			},
			{
				name: "kind",
				type: "uint8",
				indexed: !1,
				internalType: "uint8"
			},
			{
				name: "caller",
				type: "address",
				indexed: !1,
				internalType: "address"
			},
			{
				name: "payloadHash",
				type: "bytes32",
				indexed: !1,
				internalType: "bytes32"
			},
			{
				name: "result",
				type: "bytes32",
				indexed: !1,
				internalType: "bytes32"
			}
		],
		anonymous: !1
	},
	{
		type: "event",
		name: "Published",
		inputs: [
			{
				name: "mealId",
				type: "bytes32",
				indexed: !0,
				internalType: "bytes32"
			},
			{
				name: "version",
				type: "uint256",
				indexed: !1,
				internalType: "uint256"
			},
			{
				name: "termsHash",
				type: "bytes32",
				indexed: !1,
				internalType: "bytes32"
			},
			{
				name: "revision",
				type: "uint256",
				indexed: !1,
				internalType: "uint256"
			}
		],
		anonymous: !1
	},
	{
		type: "event",
		name: "Refunded",
		inputs: [
			{
				name: "batchId",
				type: "bytes32",
				indexed: !0,
				internalType: "bytes32"
			},
			{
				name: "payer",
				type: "address",
				indexed: !0,
				internalType: "address"
			},
			{
				name: "unitMask",
				type: "uint16",
				indexed: !1,
				internalType: "uint16"
			},
			{
				name: "quantity",
				type: "uint256",
				indexed: !1,
				internalType: "uint256"
			},
			{
				name: "amount",
				type: "uint256",
				indexed: !1,
				internalType: "uint256"
			}
		],
		anonymous: !1
	},
	{
		type: "event",
		name: "Reported",
		inputs: [
			{
				name: "voucherId",
				type: "bytes32",
				indexed: !0,
				internalType: "bytes32"
			},
			{
				name: "resultId",
				type: "bytes32",
				indexed: !1,
				internalType: "bytes32"
			},
			{
				name: "markerId",
				type: "bytes32",
				indexed: !1,
				internalType: "bytes32"
			},
			{
				name: "amount",
				type: "uint256",
				indexed: !1,
				internalType: "uint256"
			}
		],
		anonymous: !1
	},
	{
		type: "event",
		name: "Settled",
		inputs: [
			{
				name: "voucherId",
				type: "bytes32",
				indexed: !0,
				internalType: "bytes32"
			},
			{
				name: "opId",
				type: "bytes32",
				indexed: !1,
				internalType: "bytes32"
			},
			{
				name: "receiver",
				type: "address",
				indexed: !0,
				internalType: "address"
			},
			{
				name: "amount",
				type: "uint256",
				indexed: !1,
				internalType: "uint256"
			}
		],
		anonymous: !1
	},
	{
		type: "error",
		name: "AlreadyLocked",
		inputs: []
	},
	{
		type: "error",
		name: "AlreadyRefunded",
		inputs: []
	},
	{
		type: "error",
		name: "CandidateMismatch",
		inputs: []
	},
	{
		type: "error",
		name: "CandidateUnavailable",
		inputs: []
	},
	{
		type: "error",
		name: "CapExceeded",
		inputs: []
	},
	{
		type: "error",
		name: "ECDSAInvalidSignature",
		inputs: []
	},
	{
		type: "error",
		name: "ECDSAInvalidSignatureLength",
		inputs: [{
			name: "length",
			type: "uint256",
			internalType: "uint256"
		}]
	},
	{
		type: "error",
		name: "ECDSAInvalidSignatureS",
		inputs: [{
			name: "s",
			type: "bytes32",
			internalType: "bytes32"
		}]
	},
	{
		type: "error",
		name: "Insolvent",
		inputs: []
	},
	{
		type: "error",
		name: "InvalidBatch",
		inputs: []
	},
	{
		type: "error",
		name: "InvalidCatalog",
		inputs: []
	},
	{
		type: "error",
		name: "InvalidConfiguration",
		inputs: []
	},
	{
		type: "error",
		name: "InvalidLock",
		inputs: []
	},
	{
		type: "error",
		name: "InvalidMarker",
		inputs: []
	},
	{
		type: "error",
		name: "InvalidOperation",
		inputs: []
	},
	{
		type: "error",
		name: "InvalidQuote",
		inputs: []
	},
	{
		type: "error",
		name: "InvalidRefundMask",
		inputs: []
	},
	{
		type: "error",
		name: "InvalidShortString",
		inputs: []
	},
	{
		type: "error",
		name: "InvalidUnitState",
		inputs: []
	},
	{
		type: "error",
		name: "InvalidVoucher",
		inputs: []
	},
	{
		type: "error",
		name: "NoChange",
		inputs: []
	},
	{
		type: "error",
		name: "NotExpired",
		inputs: []
	},
	{
		type: "error",
		name: "OperatingDenied",
		inputs: []
	},
	{
		type: "error",
		name: "OperationConflict",
		inputs: []
	},
	{
		type: "error",
		name: "QuoteConflict",
		inputs: []
	},
	{
		type: "error",
		name: "QuoteExpired",
		inputs: []
	},
	{
		type: "error",
		name: "ReentrancyGuardReentrantCall",
		inputs: []
	},
	{
		type: "error",
		name: "SafeERC20FailedOperation",
		inputs: [{
			name: "token",
			type: "address",
			internalType: "address"
		}]
	},
	{
		type: "error",
		name: "StaleRevision",
		inputs: []
	},
	{
		type: "error",
		name: "StringTooLong",
		inputs: [{
			name: "str",
			type: "string",
			internalType: "string"
		}]
	},
	{
		type: "error",
		name: "TermsMismatch",
		inputs: []
	},
	{
		type: "error",
		name: "TimeDenied",
		inputs: []
	},
	{
		type: "error",
		name: "TransferDeltaMismatch",
		inputs: []
	},
	{
		type: "error",
		name: "UnauthorizedPayer",
		inputs: []
	},
	{
		type: "error",
		name: "UnauthorizedQuote",
		inputs: []
	},
	{
		type: "error",
		name: "UnauthorizedRole",
		inputs: []
	}
];
//#endregion
//#region cp30-backend/integrations/wallet/index.mjs
Wr(), ir(), st();
var Wi = ot(["function approve(address spender, uint256 amount) returns (bool)"]), Gi = "0x0000000000000000000000000000000000000000", Ki = (1n << 256n) - 1n;
function J(e) {
	throw TypeError(`Invalid ${e}`);
}
function Y(e, t, { positive: n = !1, max: r = Ki } = {}) {
	typeof e != "bigint" && !(typeof e == "string" && /^(0|[1-9][0-9]*)$/.test(e)) && J(t);
	let i = BigInt(e);
	return (i < 0n || i > r || n && i === 0n) && J(t), i;
}
function X(e, t) {
	try {
		let n = N(e);
		return n === Gi && J(t), n;
	} catch {
		J(t);
	}
}
function Z(e, t, n = !0) {
	return (typeof e != "string" || !/^0x[0-9a-fA-F]{64}$/.test(e) || n && /^0x0{64}$/.test(e)) && J(t), e.toLowerCase();
}
function qi(e, t, n = !1) {
	return (typeof e != "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(e) || !n && e === "0x") && J(t), e.toLowerCase();
}
function Q(e) {
	return (!Number.isSafeInteger(e) || e < 1) && J("chainId"), e;
}
function Ji(e, t, n) {
	X(e, n) !== X(t, n) && J(n);
}
function Yi(e, t, n) {
	Q(e.chainId) !== Q(t.chainId) && J("wallet chain binding"), Ji(t.account, n, "wallet account binding");
}
function Xi(e, t, n, r, i, a, o) {
	return {
		chainId: Q(e),
		from: X(t, "from"),
		to: X(n, "to"),
		value: 0n,
		data: Ur({
			abi: r,
			functionName: i,
			args: a
		}),
		functionName: i,
		args: a,
		correlation: o,
		authority: "PREPARATION_ONLY"
	};
}
function Zi(e) {
	Q(e.chainId);
	for (let t of [
		"escrow",
		"asset",
		"owner",
		"receiver",
		"quoteAuthority"
	]) X(e[t], t);
	Ji(e.owner, e.receiver, "owner receiver binding");
}
function Qi({ binding: e, wallet: t, payer: n, amount: r }) {
	Zi(e), Yi(e, t, n);
	let i = Y(r, "amount", { positive: !0 });
	return Xi(e.chainId, t.account, e.asset, Wi, "approve", [X(e.escrow, "escrow"), i], {
		escrow: X(e.escrow, "escrow"),
		amount: i
	});
}
function $i({ binding: e, wallet: t, signedQuote: n, now: r }) {
	Zi(e), Q(n.chainId) !== e.chainId && J("quote chain binding"), Ji(n.escrow, e.escrow, "quote escrow binding"), Ji(n.quoteAuthority, e.quoteAuthority, "quote authority binding");
	let i = n.quote;
	Yi(e, t, i.payer);
	let a = {
		quoteId: Z(i.quoteId, "quoteId"),
		payer: X(i.payer, "payer"),
		mealId: Z(i.mealId, "mealId"),
		currentVersion: Y(i.currentVersion, "currentVersion", { positive: !0 }),
		termsHash: Z(i.termsHash, "termsHash"),
		quantity: Y(i.quantity, "quantity", {
			positive: !0,
			max: 10n
		}),
		unitPrice: Y(i.unitPrice, "unitPrice", { positive: !0 }),
		amount: Y(i.amount, "amount", { positive: !0 }),
		deadline: Y(i.deadline, "deadline", { positive: !0 })
	};
	a.amount !== a.quantity * a.unitPrice && J("quote amount"), a.deadline <= Y(r, "now") && J("quote deadline");
	let o = qi(n.signature, "quote signature");
	return o.length !== 132 && J("quote signature length"), Xi(e.chainId, t.account, e.escrow, Ui, "fund", [a, o], { quoteId: a.quoteId });
}
function ea({ binding: e, wallet: t, opId: n, voucherId: r, generation: i }) {
	Zi(e), Yi(e, t, e.owner);
	let a = [
		Z(n, "opId"),
		Z(r, "voucherId"),
		Y(i, "generation", { positive: !0 })
	];
	return Xi(e.chainId, t.account, e.escrow, Ui, "settle", a, {
		opId: a[0],
		voucherId: a[1],
		generation: a[2]
	});
}
//#endregion
//#region node_modules/viem/_esm/errors/siwe.js
w();
var $ = class extends C {
	constructor(e) {
		let { docsPath: t, field: n, metaMessages: r } = e;
		super(`Invalid Sign-In with Ethereum message field "${n}".`, {
			docsPath: t,
			metaMessages: r,
			name: "SiweInvalidMessageFieldError"
		});
	}
};
//#endregion
//#region node_modules/viem/_esm/utils/siwe/utils.js
function ta(e) {
	if (/[^a-z0-9:/?#[\]@!$&'()*+,;=.\-_~%]/i.test(e) || /%[^0-9a-f]/i.test(e) || /%[0-9a-f](:?[^0-9a-f]|$)/i.test(e)) return !1;
	let t = na(e), n = t[1], r = t[2], i = t[3], a = t[4], o = t[5];
	if (!(n?.length && i.length >= 0)) return !1;
	if (r?.length) {
		if (!(i.length === 0 || /^\//.test(i))) return !1;
	} else if (/^\/\//.test(i)) return !1;
	if (!/^[a-z][a-z0-9+\-.]*$/.test(n.toLowerCase())) return !1;
	let s = "";
	return s += `${n}:`, r?.length && (s += `//${r}`), s += i, a?.length && (s += `?${a}`), o?.length && (s += `#${o}`), s;
}
function na(e) {
	return e.match(/(?:([^:/?#]+):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?/);
}
//#endregion
//#region node_modules/viem/_esm/utils/siwe/createSiweMessage.js
ir();
function ra(e) {
	let { chainId: t, domain: n, expirationTime: r, issuedAt: i = /* @__PURE__ */ new Date(), nonce: a, notBefore: o, requestId: s, resources: c, scheme: l, uri: u, version: d } = e;
	{
		if (t !== Math.floor(t)) throw new $({
			field: "chainId",
			metaMessages: [
				"- Chain ID must be a EIP-155 chain ID.",
				"- See https://eips.ethereum.org/EIPS/eip-155",
				"",
				`Provided value: ${t}`
			]
		});
		if (!(ia.test(n) || aa.test(n) || oa.test(n))) throw new $({
			field: "domain",
			metaMessages: [
				"- Domain must be an RFC 3986 authority.",
				"- See https://www.rfc-editor.org/rfc/rfc3986",
				"",
				`Provided value: ${n}`
			]
		});
		if (!sa.test(a)) throw new $({
			field: "nonce",
			metaMessages: [
				"- Nonce must be at least 8 characters.",
				"- Nonce must be alphanumeric.",
				"",
				`Provided value: ${a}`
			]
		});
		if (!ta(u)) throw new $({
			field: "uri",
			metaMessages: [
				"- URI must be a RFC 3986 URI referring to the resource that is the subject of the signing.",
				"- See https://www.rfc-editor.org/rfc/rfc3986",
				"",
				`Provided value: ${u}`
			]
		});
		if (d !== "1") throw new $({
			field: "version",
			metaMessages: [
				"- Version must be '1'.",
				"",
				`Provided value: ${d}`
			]
		});
		if (l && !ca.test(l)) throw new $({
			field: "scheme",
			metaMessages: [
				"- Scheme must be an RFC 3986 URI scheme.",
				"- See https://www.rfc-editor.org/rfc/rfc3986#section-3.1",
				"",
				`Provided value: ${l}`
			]
		});
		let r = e.statement;
		if (r?.includes("\n")) throw new $({
			field: "statement",
			metaMessages: [
				"- Statement must not include '\\n'.",
				"",
				`Provided value: ${r}`
			]
		});
	}
	let f = N(e.address), p = `${l ? `${l}://${n}` : n} wants you to sign in with your Ethereum account:\n${f}\n\n${e.statement ? `${e.statement}\n` : ""}`, m = `URI: ${u}\nVersion: ${d}\nChain ID: ${t}\nNonce: ${a}\nIssued At: ${i.toISOString()}`;
	if (r && (m += `\nExpiration Time: ${r.toISOString()}`), o && (m += `\nNot Before: ${o.toISOString()}`), s && (m += `\nRequest ID: ${s}`), c) {
		let e = "\nResources:";
		for (let t of c) {
			if (!ta(t)) throw new $({
				field: "resources",
				metaMessages: [
					"- Every resource must be a RFC 3986 URI.",
					"- See https://www.rfc-editor.org/rfc/rfc3986",
					"",
					`Provided value: ${t}`
				]
			});
			e += `\n- ${t}`;
		}
		m += e;
	}
	return `${p}\n${m}`;
}
var ia = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(:[0-9]{1,5})?$/, aa = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(:[0-9]{1,5})?$/, oa = /^localhost(:[0-9]{1,5})?$/, sa = /^[a-zA-Z0-9]{8,}$/, ca = /^([a-zA-Z][a-zA-Z0-9+\-.]*)$/;
//#endregion
//#region cp30-backend/consumer/wallet-entry.js
ir();
function la(e, { address: t, chainId: n, origin: r, now: i }) {
	let a = [
		"challengeId",
		"address",
		"chainId",
		"nonce",
		"domain",
		"uri",
		"issuedAt",
		"expiresAt",
		"message"
	], o = () => {
		throw Error("钱包登录请求不匹配或已过期，请重新点击登录。");
	};
	(!e || typeof e != "object" || Array.isArray(e) || Object.keys(e).length !== a.length || a.some((t) => !Object.hasOwn(e, t))) && o();
	let s;
	try {
		s = new URL(r);
	} catch {
		o();
	}
	(s.origin !== r || !["http:", "https:"].includes(s.protocol) || e.domain !== s.host || e.uri !== r || n !== 10143 || e.chainId !== n) && o(), (!/^0x[0-9a-f]{40}$/.test(e.address) || e.address === "0x" + "0".repeat(40) || e.address !== N(t).toLowerCase()) && o(), (!/^[0-9a-f]{64}$/.test(e.nonce) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(e.challengeId)) && o();
	let { issuedAt: c, expiresAt: l } = e;
	(!Number.isSafeInteger(i) || !Number.isSafeInteger(c) || !Number.isSafeInteger(l) || c <= 0 || c > i || l <= i || l <= c || l - c > 300) && o();
	let u = ra({
		address: N(e.address),
		domain: e.domain,
		uri: e.uri,
		chainId: n,
		nonce: e.nonce,
		issuedAt: /* @__PURE__ */ new Date(c * 1e3),
		expirationTime: /* @__PURE__ */ new Date(l * 1e3),
		statement: "Sign in to MealForward with your test wallet.",
		version: "1",
		requestId: e.challengeId
	});
	return e.message !== u && o(), u;
}
async function ua(e, t, n) {
	let r = la(t, n), i = N(n.address), a = ji({
		account: i,
		transport: Hi(e, {
			retryCount: 0,
			methods: { include: ["personal_sign"] }
		})
	});
	try {
		return await Bi(a, {
			account: i,
			message: r
		});
	} catch {
		throw Error("钱包登录签名未完成。请确认钱包提示后，重新点击登录。");
	}
}
function da(e, t) {
	if (!Number.isInteger(t) || t < 0 || t > 36 || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(e) || (e.split(".")[1]?.length || 0) > t) throw Error("Check the meal price.");
	let n = zi(e, t);
	if (n <= 0n) throw Error("Check the meal price.");
	return n.toString();
}
function fa(e, t, n = "") {
	if (!Number.isInteger(t) || t < 0 || t > 36 || !/^(0|[1-9][0-9]*)$/.test(String(e))) throw Error("The configured amount is unavailable.");
	return Ri(BigInt(e), t) + (n ? " " + n : "");
}
//#endregion
export { Qi as prepareApprove, $i as prepareFund, ea as prepareSettle, fa as priceDisplay, da as priceUnits, ua as signWalletLoginMessage, la as validateWalletLoginChallenge };
