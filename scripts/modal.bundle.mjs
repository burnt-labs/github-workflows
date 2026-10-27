/* eslint-disable */

// scripts/modal-cli.mjs
import fs2 from "node:fs";
import process2 from "node:process";

// scripts/modal.mjs
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

// node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/scanner.js
function createScanner(text2, ignoreTrivia = false) {
  const len = text2.length;
  let pos = 0,
    value = "",
    tokenOffset = 0,
    token = 16,
    lineNumber = 0,
    lineStartOffset = 0,
    tokenLineStartOffset = 0,
    prevTokenLineStartOffset = 0,
    scanError = 0;
  function scanHexDigits(count, exact) {
    let digits = 0;
    let value2 = 0;
    while (digits < count || !exact) {
      let ch = text2.charCodeAt(pos);
      if (ch >= 48 && ch <= 57) {
        value2 = value2 * 16 + ch - 48;
      } else if (ch >= 65 && ch <= 70) {
        value2 = value2 * 16 + ch - 65 + 10;
      } else if (ch >= 97 && ch <= 102) {
        value2 = value2 * 16 + ch - 97 + 10;
      } else {
        break;
      }
      pos++;
      digits++;
    }
    if (digits < count) {
      value2 = -1;
    }
    return value2;
  }
  function setPosition(newPosition) {
    pos = newPosition;
    value = "";
    tokenOffset = 0;
    token = 16;
    scanError = 0;
  }
  function scanNumber() {
    let start = pos;
    if (text2.charCodeAt(pos) === 48) {
      pos++;
    } else {
      pos++;
      while (pos < text2.length && isDigit(text2.charCodeAt(pos))) {
        pos++;
      }
    }
    if (pos < text2.length && text2.charCodeAt(pos) === 46) {
      pos++;
      if (pos < text2.length && isDigit(text2.charCodeAt(pos))) {
        pos++;
        while (pos < text2.length && isDigit(text2.charCodeAt(pos))) {
          pos++;
        }
      } else {
        scanError = 3;
        return text2.substring(start, pos);
      }
    }
    let end = pos;
    if (
      pos < text2.length &&
      (text2.charCodeAt(pos) === 69 || text2.charCodeAt(pos) === 101)
    ) {
      pos++;
      if (
        (pos < text2.length && text2.charCodeAt(pos) === 43) ||
        text2.charCodeAt(pos) === 45
      ) {
        pos++;
      }
      if (pos < text2.length && isDigit(text2.charCodeAt(pos))) {
        pos++;
        while (pos < text2.length && isDigit(text2.charCodeAt(pos))) {
          pos++;
        }
        end = pos;
      } else {
        scanError = 3;
      }
    }
    return text2.substring(start, end);
  }
  function scanString() {
    let result = "",
      start = pos;
    while (true) {
      if (pos >= len) {
        result += text2.substring(start, pos);
        scanError = 2;
        break;
      }
      const ch = text2.charCodeAt(pos);
      if (ch === 34) {
        result += text2.substring(start, pos);
        pos++;
        break;
      }
      if (ch === 92) {
        result += text2.substring(start, pos);
        pos++;
        if (pos >= len) {
          scanError = 2;
          break;
        }
        const ch2 = text2.charCodeAt(pos++);
        switch (ch2) {
          case 34:
            result += '"';
            break;
          case 92:
            result += "\\";
            break;
          case 47:
            result += "/";
            break;
          case 98:
            result += "\b";
            break;
          case 102:
            result += "\f";
            break;
          case 110:
            result += "\n";
            break;
          case 114:
            result += "\r";
            break;
          case 116:
            result += "	";
            break;
          case 117:
            const ch3 = scanHexDigits(4, true);
            if (ch3 >= 0) {
              result += String.fromCharCode(ch3);
            } else {
              scanError = 4;
            }
            break;
          default:
            scanError = 5;
        }
        start = pos;
        continue;
      }
      if (ch >= 0 && ch <= 31) {
        if (isLineBreak(ch)) {
          result += text2.substring(start, pos);
          scanError = 2;
          break;
        } else {
          scanError = 6;
        }
      }
      pos++;
    }
    return result;
  }
  function scanNext() {
    value = "";
    scanError = 0;
    tokenOffset = pos;
    lineStartOffset = lineNumber;
    prevTokenLineStartOffset = tokenLineStartOffset;
    if (pos >= len) {
      tokenOffset = len;
      return (token = 17);
    }
    let code = text2.charCodeAt(pos);
    if (isWhiteSpace(code)) {
      do {
        pos++;
        value += String.fromCharCode(code);
        code = text2.charCodeAt(pos);
      } while (isWhiteSpace(code));
      return (token = 15);
    }
    if (isLineBreak(code)) {
      pos++;
      value += String.fromCharCode(code);
      if (code === 13 && text2.charCodeAt(pos) === 10) {
        pos++;
        value += "\n";
      }
      lineNumber++;
      tokenLineStartOffset = pos;
      return (token = 14);
    }
    switch (code) {
      // tokens: []{}:,
      case 123:
        pos++;
        return (token = 1);
      case 125:
        pos++;
        return (token = 2);
      case 91:
        pos++;
        return (token = 3);
      case 93:
        pos++;
        return (token = 4);
      case 58:
        pos++;
        return (token = 6);
      case 44:
        pos++;
        return (token = 5);
      // strings
      case 34:
        pos++;
        value = scanString();
        return (token = 10);
      // comments
      case 47:
        const start = pos - 1;
        if (text2.charCodeAt(pos + 1) === 47) {
          pos += 2;
          while (pos < len) {
            if (isLineBreak(text2.charCodeAt(pos))) {
              break;
            }
            pos++;
          }
          value = text2.substring(start, pos);
          return (token = 12);
        }
        if (text2.charCodeAt(pos + 1) === 42) {
          pos += 2;
          const safeLength = len - 1;
          let commentClosed = false;
          while (pos < safeLength) {
            const ch = text2.charCodeAt(pos);
            if (ch === 42 && text2.charCodeAt(pos + 1) === 47) {
              pos += 2;
              commentClosed = true;
              break;
            }
            pos++;
            if (isLineBreak(ch)) {
              if (ch === 13 && text2.charCodeAt(pos) === 10) {
                pos++;
              }
              lineNumber++;
              tokenLineStartOffset = pos;
            }
          }
          if (!commentClosed) {
            pos++;
            scanError = 1;
          }
          value = text2.substring(start, pos);
          return (token = 13);
        }
        value += String.fromCharCode(code);
        pos++;
        return (token = 16);
      // numbers
      case 45:
        value += String.fromCharCode(code);
        pos++;
        if (pos === len || !isDigit(text2.charCodeAt(pos))) {
          return (token = 16);
        }
      // found a minus, followed by a number so
      // we fall through to proceed with scanning
      // numbers
      case 48:
      case 49:
      case 50:
      case 51:
      case 52:
      case 53:
      case 54:
      case 55:
      case 56:
      case 57:
        value += scanNumber();
        return (token = 11);
      // literals and unknown symbols
      default:
        while (pos < len && isUnknownContentCharacter(code)) {
          pos++;
          code = text2.charCodeAt(pos);
        }
        if (tokenOffset !== pos) {
          value = text2.substring(tokenOffset, pos);
          switch (value) {
            case "true":
              return (token = 8);
            case "false":
              return (token = 9);
            case "null":
              return (token = 7);
          }
          return (token = 16);
        }
        value += String.fromCharCode(code);
        pos++;
        return (token = 16);
    }
  }
  function isUnknownContentCharacter(code) {
    if (isWhiteSpace(code) || isLineBreak(code)) {
      return false;
    }
    switch (code) {
      case 125:
      case 93:
      case 123:
      case 91:
      case 34:
      case 58:
      case 44:
      case 47:
        return false;
    }
    return true;
  }
  function scanNextNonTrivia() {
    let result;
    do {
      result = scanNext();
    } while (result >= 12 && result <= 15);
    return result;
  }
  return {
    setPosition,
    getPosition: () => pos,
    scan: ignoreTrivia ? scanNextNonTrivia : scanNext,
    getToken: () => token,
    getTokenValue: () => value,
    getTokenOffset: () => tokenOffset,
    getTokenLength: () => pos - tokenOffset,
    getTokenStartLine: () => lineStartOffset,
    getTokenStartCharacter: () => tokenOffset - prevTokenLineStartOffset,
    getTokenError: () => scanError,
  };
}
function isWhiteSpace(ch) {
  return ch === 32 || ch === 9;
}
function isLineBreak(ch) {
  return ch === 10 || ch === 13;
}
function isDigit(ch) {
  return ch >= 48 && ch <= 57;
}
var CharacterCodes;
(function (CharacterCodes2) {
  CharacterCodes2[(CharacterCodes2["lineFeed"] = 10)] = "lineFeed";
  CharacterCodes2[(CharacterCodes2["carriageReturn"] = 13)] = "carriageReturn";
  CharacterCodes2[(CharacterCodes2["space"] = 32)] = "space";
  CharacterCodes2[(CharacterCodes2["_0"] = 48)] = "_0";
  CharacterCodes2[(CharacterCodes2["_1"] = 49)] = "_1";
  CharacterCodes2[(CharacterCodes2["_2"] = 50)] = "_2";
  CharacterCodes2[(CharacterCodes2["_3"] = 51)] = "_3";
  CharacterCodes2[(CharacterCodes2["_4"] = 52)] = "_4";
  CharacterCodes2[(CharacterCodes2["_5"] = 53)] = "_5";
  CharacterCodes2[(CharacterCodes2["_6"] = 54)] = "_6";
  CharacterCodes2[(CharacterCodes2["_7"] = 55)] = "_7";
  CharacterCodes2[(CharacterCodes2["_8"] = 56)] = "_8";
  CharacterCodes2[(CharacterCodes2["_9"] = 57)] = "_9";
  CharacterCodes2[(CharacterCodes2["a"] = 97)] = "a";
  CharacterCodes2[(CharacterCodes2["b"] = 98)] = "b";
  CharacterCodes2[(CharacterCodes2["c"] = 99)] = "c";
  CharacterCodes2[(CharacterCodes2["d"] = 100)] = "d";
  CharacterCodes2[(CharacterCodes2["e"] = 101)] = "e";
  CharacterCodes2[(CharacterCodes2["f"] = 102)] = "f";
  CharacterCodes2[(CharacterCodes2["g"] = 103)] = "g";
  CharacterCodes2[(CharacterCodes2["h"] = 104)] = "h";
  CharacterCodes2[(CharacterCodes2["i"] = 105)] = "i";
  CharacterCodes2[(CharacterCodes2["j"] = 106)] = "j";
  CharacterCodes2[(CharacterCodes2["k"] = 107)] = "k";
  CharacterCodes2[(CharacterCodes2["l"] = 108)] = "l";
  CharacterCodes2[(CharacterCodes2["m"] = 109)] = "m";
  CharacterCodes2[(CharacterCodes2["n"] = 110)] = "n";
  CharacterCodes2[(CharacterCodes2["o"] = 111)] = "o";
  CharacterCodes2[(CharacterCodes2["p"] = 112)] = "p";
  CharacterCodes2[(CharacterCodes2["q"] = 113)] = "q";
  CharacterCodes2[(CharacterCodes2["r"] = 114)] = "r";
  CharacterCodes2[(CharacterCodes2["s"] = 115)] = "s";
  CharacterCodes2[(CharacterCodes2["t"] = 116)] = "t";
  CharacterCodes2[(CharacterCodes2["u"] = 117)] = "u";
  CharacterCodes2[(CharacterCodes2["v"] = 118)] = "v";
  CharacterCodes2[(CharacterCodes2["w"] = 119)] = "w";
  CharacterCodes2[(CharacterCodes2["x"] = 120)] = "x";
  CharacterCodes2[(CharacterCodes2["y"] = 121)] = "y";
  CharacterCodes2[(CharacterCodes2["z"] = 122)] = "z";
  CharacterCodes2[(CharacterCodes2["A"] = 65)] = "A";
  CharacterCodes2[(CharacterCodes2["B"] = 66)] = "B";
  CharacterCodes2[(CharacterCodes2["C"] = 67)] = "C";
  CharacterCodes2[(CharacterCodes2["D"] = 68)] = "D";
  CharacterCodes2[(CharacterCodes2["E"] = 69)] = "E";
  CharacterCodes2[(CharacterCodes2["F"] = 70)] = "F";
  CharacterCodes2[(CharacterCodes2["G"] = 71)] = "G";
  CharacterCodes2[(CharacterCodes2["H"] = 72)] = "H";
  CharacterCodes2[(CharacterCodes2["I"] = 73)] = "I";
  CharacterCodes2[(CharacterCodes2["J"] = 74)] = "J";
  CharacterCodes2[(CharacterCodes2["K"] = 75)] = "K";
  CharacterCodes2[(CharacterCodes2["L"] = 76)] = "L";
  CharacterCodes2[(CharacterCodes2["M"] = 77)] = "M";
  CharacterCodes2[(CharacterCodes2["N"] = 78)] = "N";
  CharacterCodes2[(CharacterCodes2["O"] = 79)] = "O";
  CharacterCodes2[(CharacterCodes2["P"] = 80)] = "P";
  CharacterCodes2[(CharacterCodes2["Q"] = 81)] = "Q";
  CharacterCodes2[(CharacterCodes2["R"] = 82)] = "R";
  CharacterCodes2[(CharacterCodes2["S"] = 83)] = "S";
  CharacterCodes2[(CharacterCodes2["T"] = 84)] = "T";
  CharacterCodes2[(CharacterCodes2["U"] = 85)] = "U";
  CharacterCodes2[(CharacterCodes2["V"] = 86)] = "V";
  CharacterCodes2[(CharacterCodes2["W"] = 87)] = "W";
  CharacterCodes2[(CharacterCodes2["X"] = 88)] = "X";
  CharacterCodes2[(CharacterCodes2["Y"] = 89)] = "Y";
  CharacterCodes2[(CharacterCodes2["Z"] = 90)] = "Z";
  CharacterCodes2[(CharacterCodes2["asterisk"] = 42)] = "asterisk";
  CharacterCodes2[(CharacterCodes2["backslash"] = 92)] = "backslash";
  CharacterCodes2[(CharacterCodes2["closeBrace"] = 125)] = "closeBrace";
  CharacterCodes2[(CharacterCodes2["closeBracket"] = 93)] = "closeBracket";
  CharacterCodes2[(CharacterCodes2["colon"] = 58)] = "colon";
  CharacterCodes2[(CharacterCodes2["comma"] = 44)] = "comma";
  CharacterCodes2[(CharacterCodes2["dot"] = 46)] = "dot";
  CharacterCodes2[(CharacterCodes2["doubleQuote"] = 34)] = "doubleQuote";
  CharacterCodes2[(CharacterCodes2["minus"] = 45)] = "minus";
  CharacterCodes2[(CharacterCodes2["openBrace"] = 123)] = "openBrace";
  CharacterCodes2[(CharacterCodes2["openBracket"] = 91)] = "openBracket";
  CharacterCodes2[(CharacterCodes2["plus"] = 43)] = "plus";
  CharacterCodes2[(CharacterCodes2["slash"] = 47)] = "slash";
  CharacterCodes2[(CharacterCodes2["formFeed"] = 12)] = "formFeed";
  CharacterCodes2[(CharacterCodes2["tab"] = 9)] = "tab";
})(CharacterCodes || (CharacterCodes = {}));

// node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/string-intern.js
var cachedSpaces = new Array(20).fill(0).map((_, index) => {
  return " ".repeat(index);
});
var maxCachedValues = 200;
var cachedBreakLinesWithSpaces = {
  " ": {
    "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\n" + " ".repeat(index);
    }),
    "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r" + " ".repeat(index);
    }),
    "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r\n" + " ".repeat(index);
    }),
  },
  "	": {
    "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\n" + "	".repeat(index);
    }),
    "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r" + "	".repeat(index);
    }),
    "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r\n" + "	".repeat(index);
    }),
  },
};

// node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/parser.js
var ParseOptions;
(function (ParseOptions2) {
  ParseOptions2.DEFAULT = {
    allowTrailingComma: false,
  };
})(ParseOptions || (ParseOptions = {}));
function parseTree(text2, errors = [], options = ParseOptions.DEFAULT) {
  let currentParent = {
    type: "array",
    offset: -1,
    length: -1,
    children: [],
    parent: void 0,
  };
  function ensurePropertyComplete(endOffset) {
    if (currentParent.type === "property") {
      currentParent.length = endOffset - currentParent.offset;
      currentParent = currentParent.parent;
    }
  }
  function onValue(valueNode) {
    currentParent.children.push(valueNode);
    return valueNode;
  }
  const visitor = {
    onObjectBegin: (offset) => {
      currentParent = onValue({
        type: "object",
        offset,
        length: -1,
        parent: currentParent,
        children: [],
      });
    },
    onObjectProperty: (name, offset, length) => {
      currentParent = onValue({
        type: "property",
        offset,
        length: -1,
        parent: currentParent,
        children: [],
      });
      currentParent.children.push({
        type: "string",
        value: name,
        offset,
        length,
        parent: currentParent,
      });
    },
    onObjectEnd: (offset, length) => {
      ensurePropertyComplete(offset + length);
      currentParent.length = offset + length - currentParent.offset;
      currentParent = currentParent.parent;
      ensurePropertyComplete(offset + length);
    },
    onArrayBegin: (offset, length) => {
      currentParent = onValue({
        type: "array",
        offset,
        length: -1,
        parent: currentParent,
        children: [],
      });
    },
    onArrayEnd: (offset, length) => {
      currentParent.length = offset + length - currentParent.offset;
      currentParent = currentParent.parent;
      ensurePropertyComplete(offset + length);
    },
    onLiteralValue: (value, offset, length) => {
      onValue({
        type: getNodeType(value),
        offset,
        length,
        parent: currentParent,
        value,
      });
      ensurePropertyComplete(offset + length);
    },
    onSeparator: (sep, offset, length) => {
      if (currentParent.type === "property") {
        if (sep === ":") {
          currentParent.colonOffset = offset;
        } else if (sep === ",") {
          ensurePropertyComplete(offset);
        }
      }
    },
    onError: (error, offset, length) => {
      errors.push({ error, offset, length });
    },
  };
  visit(text2, visitor, options);
  const result = currentParent.children[0];
  if (result) {
    delete result.parent;
  }
  return result;
}
function getNodeValue(node) {
  switch (node.type) {
    case "array":
      return node.children.map(getNodeValue);
    case "object":
      const obj = /* @__PURE__ */ Object.create(null);
      for (let prop of node.children) {
        const valueNode = prop.children[1];
        if (valueNode) {
          obj[prop.children[0].value] = getNodeValue(valueNode);
        }
      }
      return obj;
    case "null":
    case "string":
    case "number":
    case "boolean":
      return node.value;
    default:
      return void 0;
  }
}
function visit(text2, visitor, options = ParseOptions.DEFAULT) {
  const _scanner = createScanner(text2, false);
  const _jsonPath = [];
  let suppressedCallbacks = 0;
  function toNoArgVisit(visitFunction) {
    return visitFunction
      ? () =>
          suppressedCallbacks === 0 &&
          visitFunction(
            _scanner.getTokenOffset(),
            _scanner.getTokenLength(),
            _scanner.getTokenStartLine(),
            _scanner.getTokenStartCharacter(),
          )
      : () => true;
  }
  function toOneArgVisit(visitFunction) {
    return visitFunction
      ? (arg) =>
          suppressedCallbacks === 0 &&
          visitFunction(
            arg,
            _scanner.getTokenOffset(),
            _scanner.getTokenLength(),
            _scanner.getTokenStartLine(),
            _scanner.getTokenStartCharacter(),
          )
      : () => true;
  }
  function toOneArgVisitWithPath(visitFunction) {
    return visitFunction
      ? (arg) =>
          suppressedCallbacks === 0 &&
          visitFunction(
            arg,
            _scanner.getTokenOffset(),
            _scanner.getTokenLength(),
            _scanner.getTokenStartLine(),
            _scanner.getTokenStartCharacter(),
            () => _jsonPath.slice(),
          )
      : () => true;
  }
  function toBeginVisit(visitFunction) {
    return visitFunction
      ? () => {
          if (suppressedCallbacks > 0) {
            suppressedCallbacks++;
          } else {
            let cbReturn = visitFunction(
              _scanner.getTokenOffset(),
              _scanner.getTokenLength(),
              _scanner.getTokenStartLine(),
              _scanner.getTokenStartCharacter(),
              () => _jsonPath.slice(),
            );
            if (cbReturn === false) {
              suppressedCallbacks = 1;
            }
          }
        }
      : () => true;
  }
  function toEndVisit(visitFunction) {
    return visitFunction
      ? () => {
          if (suppressedCallbacks > 0) {
            suppressedCallbacks--;
          }
          if (suppressedCallbacks === 0) {
            visitFunction(
              _scanner.getTokenOffset(),
              _scanner.getTokenLength(),
              _scanner.getTokenStartLine(),
              _scanner.getTokenStartCharacter(),
            );
          }
        }
      : () => true;
  }
  const onObjectBegin = toBeginVisit(visitor.onObjectBegin),
    onObjectProperty = toOneArgVisitWithPath(visitor.onObjectProperty),
    onObjectEnd = toEndVisit(visitor.onObjectEnd),
    onArrayBegin = toBeginVisit(visitor.onArrayBegin),
    onArrayEnd = toEndVisit(visitor.onArrayEnd),
    onLiteralValue = toOneArgVisitWithPath(visitor.onLiteralValue),
    onSeparator = toOneArgVisit(visitor.onSeparator),
    onComment = toNoArgVisit(visitor.onComment),
    onError = toOneArgVisit(visitor.onError);
  const disallowComments = options && options.disallowComments;
  const allowTrailingComma = options && options.allowTrailingComma;
  function scanNext() {
    while (true) {
      const token = _scanner.scan();
      switch (_scanner.getTokenError()) {
        case 4:
          handleError(
            14,
            /* ParseErrorCode.InvalidUnicode */
          );
          break;
        case 5:
          handleError(
            15,
            /* ParseErrorCode.InvalidEscapeCharacter */
          );
          break;
        case 3:
          handleError(
            13,
            /* ParseErrorCode.UnexpectedEndOfNumber */
          );
          break;
        case 1:
          if (!disallowComments) {
            handleError(
              11,
              /* ParseErrorCode.UnexpectedEndOfComment */
            );
          }
          break;
        case 2:
          handleError(
            12,
            /* ParseErrorCode.UnexpectedEndOfString */
          );
          break;
        case 6:
          handleError(
            16,
            /* ParseErrorCode.InvalidCharacter */
          );
          break;
      }
      switch (token) {
        case 12:
        case 13:
          if (disallowComments) {
            handleError(
              10,
              /* ParseErrorCode.InvalidCommentToken */
            );
          } else {
            onComment();
          }
          break;
        case 16:
          handleError(
            1,
            /* ParseErrorCode.InvalidSymbol */
          );
          break;
        case 15:
        case 14:
          break;
        default:
          return token;
      }
    }
  }
  function handleError(error, skipUntilAfter = [], skipUntil = []) {
    onError(error);
    if (skipUntilAfter.length + skipUntil.length > 0) {
      let token = _scanner.getToken();
      while (token !== 17) {
        if (skipUntilAfter.indexOf(token) !== -1) {
          scanNext();
          break;
        } else if (skipUntil.indexOf(token) !== -1) {
          break;
        }
        token = scanNext();
      }
    }
  }
  function parseString(isValue) {
    const value = _scanner.getTokenValue();
    if (isValue) {
      onLiteralValue(value);
    } else {
      onObjectProperty(value);
      _jsonPath.push(value);
    }
    scanNext();
    return true;
  }
  function parseLiteral() {
    switch (_scanner.getToken()) {
      case 11:
        const tokenValue = _scanner.getTokenValue();
        let value = Number(tokenValue);
        if (isNaN(value)) {
          handleError(
            2,
            /* ParseErrorCode.InvalidNumberFormat */
          );
          value = 0;
        }
        onLiteralValue(value);
        break;
      case 7:
        onLiteralValue(null);
        break;
      case 8:
        onLiteralValue(true);
        break;
      case 9:
        onLiteralValue(false);
        break;
      default:
        return false;
    }
    scanNext();
    return true;
  }
  function parseProperty() {
    if (_scanner.getToken() !== 10) {
      handleError(
        3,
        [],
        [
          2, 5,
          /* SyntaxKind.CommaToken */
        ],
      );
      return false;
    }
    parseString(false);
    if (_scanner.getToken() === 6) {
      onSeparator(":");
      scanNext();
      if (!parseValue()) {
        handleError(
          4,
          [],
          [
            2, 5,
            /* SyntaxKind.CommaToken */
          ],
        );
      }
    } else {
      handleError(
        5,
        [],
        [
          2, 5,
          /* SyntaxKind.CommaToken */
        ],
      );
    }
    _jsonPath.pop();
    return true;
  }
  function parseObject() {
    onObjectBegin();
    scanNext();
    let needsComma = false;
    while (_scanner.getToken() !== 2 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 2 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (!parseProperty()) {
        handleError(
          4,
          [],
          [
            2, 5,
            /* SyntaxKind.CommaToken */
          ],
        );
      }
      needsComma = true;
    }
    onObjectEnd();
    if (_scanner.getToken() !== 2) {
      handleError(
        7,
        [
          2,
          /* SyntaxKind.CloseBraceToken */
        ],
        [],
      );
    } else {
      scanNext();
    }
    return true;
  }
  function parseArray() {
    onArrayBegin();
    scanNext();
    let isFirstElement = true;
    let needsComma = false;
    while (_scanner.getToken() !== 4 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 4 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (isFirstElement) {
        _jsonPath.push(0);
        isFirstElement = false;
      } else {
        _jsonPath[_jsonPath.length - 1]++;
      }
      if (!parseValue()) {
        handleError(
          4,
          [],
          [
            4, 5,
            /* SyntaxKind.CommaToken */
          ],
        );
      }
      needsComma = true;
    }
    onArrayEnd();
    if (!isFirstElement) {
      _jsonPath.pop();
    }
    if (_scanner.getToken() !== 4) {
      handleError(
        8,
        [
          4,
          /* SyntaxKind.CloseBracketToken */
        ],
        [],
      );
    } else {
      scanNext();
    }
    return true;
  }
  function parseValue() {
    switch (_scanner.getToken()) {
      case 3:
        return parseArray();
      case 1:
        return parseObject();
      case 10:
        return parseString(true);
      default:
        return parseLiteral();
    }
  }
  scanNext();
  if (_scanner.getToken() === 17) {
    if (options.allowEmptyContent) {
      return true;
    }
    handleError(4, [], []);
    return false;
  }
  if (!parseValue()) {
    handleError(4, [], []);
    return false;
  }
  if (_scanner.getToken() !== 17) {
    handleError(9, [], []);
  }
  return true;
}
function getNodeType(value) {
  switch (typeof value) {
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "string":
      return "string";
    case "object": {
      if (!value) {
        return "null";
      } else if (Array.isArray(value)) {
        return "array";
      }
      return "object";
    }
    default:
      return "null";
  }
}

// node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/main.js
var ScanError;
(function (ScanError2) {
  ScanError2[(ScanError2["None"] = 0)] = "None";
  ScanError2[(ScanError2["UnexpectedEndOfComment"] = 1)] =
    "UnexpectedEndOfComment";
  ScanError2[(ScanError2["UnexpectedEndOfString"] = 2)] =
    "UnexpectedEndOfString";
  ScanError2[(ScanError2["UnexpectedEndOfNumber"] = 3)] =
    "UnexpectedEndOfNumber";
  ScanError2[(ScanError2["InvalidUnicode"] = 4)] = "InvalidUnicode";
  ScanError2[(ScanError2["InvalidEscapeCharacter"] = 5)] =
    "InvalidEscapeCharacter";
  ScanError2[(ScanError2["InvalidCharacter"] = 6)] = "InvalidCharacter";
})(ScanError || (ScanError = {}));
var SyntaxKind;
(function (SyntaxKind2) {
  SyntaxKind2[(SyntaxKind2["OpenBraceToken"] = 1)] = "OpenBraceToken";
  SyntaxKind2[(SyntaxKind2["CloseBraceToken"] = 2)] = "CloseBraceToken";
  SyntaxKind2[(SyntaxKind2["OpenBracketToken"] = 3)] = "OpenBracketToken";
  SyntaxKind2[(SyntaxKind2["CloseBracketToken"] = 4)] = "CloseBracketToken";
  SyntaxKind2[(SyntaxKind2["CommaToken"] = 5)] = "CommaToken";
  SyntaxKind2[(SyntaxKind2["ColonToken"] = 6)] = "ColonToken";
  SyntaxKind2[(SyntaxKind2["NullKeyword"] = 7)] = "NullKeyword";
  SyntaxKind2[(SyntaxKind2["TrueKeyword"] = 8)] = "TrueKeyword";
  SyntaxKind2[(SyntaxKind2["FalseKeyword"] = 9)] = "FalseKeyword";
  SyntaxKind2[(SyntaxKind2["StringLiteral"] = 10)] = "StringLiteral";
  SyntaxKind2[(SyntaxKind2["NumericLiteral"] = 11)] = "NumericLiteral";
  SyntaxKind2[(SyntaxKind2["LineCommentTrivia"] = 12)] = "LineCommentTrivia";
  SyntaxKind2[(SyntaxKind2["BlockCommentTrivia"] = 13)] = "BlockCommentTrivia";
  SyntaxKind2[(SyntaxKind2["LineBreakTrivia"] = 14)] = "LineBreakTrivia";
  SyntaxKind2[(SyntaxKind2["Trivia"] = 15)] = "Trivia";
  SyntaxKind2[(SyntaxKind2["Unknown"] = 16)] = "Unknown";
  SyntaxKind2[(SyntaxKind2["EOF"] = 17)] = "EOF";
})(SyntaxKind || (SyntaxKind = {}));
var parseTree2 = parseTree;
var getNodeValue2 = getNodeValue;
var ParseErrorCode;
(function (ParseErrorCode2) {
  ParseErrorCode2[(ParseErrorCode2["InvalidSymbol"] = 1)] = "InvalidSymbol";
  ParseErrorCode2[(ParseErrorCode2["InvalidNumberFormat"] = 2)] =
    "InvalidNumberFormat";
  ParseErrorCode2[(ParseErrorCode2["PropertyNameExpected"] = 3)] =
    "PropertyNameExpected";
  ParseErrorCode2[(ParseErrorCode2["ValueExpected"] = 4)] = "ValueExpected";
  ParseErrorCode2[(ParseErrorCode2["ColonExpected"] = 5)] = "ColonExpected";
  ParseErrorCode2[(ParseErrorCode2["CommaExpected"] = 6)] = "CommaExpected";
  ParseErrorCode2[(ParseErrorCode2["CloseBraceExpected"] = 7)] =
    "CloseBraceExpected";
  ParseErrorCode2[(ParseErrorCode2["CloseBracketExpected"] = 8)] =
    "CloseBracketExpected";
  ParseErrorCode2[(ParseErrorCode2["EndOfFileExpected"] = 9)] =
    "EndOfFileExpected";
  ParseErrorCode2[(ParseErrorCode2["InvalidCommentToken"] = 10)] =
    "InvalidCommentToken";
  ParseErrorCode2[(ParseErrorCode2["UnexpectedEndOfComment"] = 11)] =
    "UnexpectedEndOfComment";
  ParseErrorCode2[(ParseErrorCode2["UnexpectedEndOfString"] = 12)] =
    "UnexpectedEndOfString";
  ParseErrorCode2[(ParseErrorCode2["UnexpectedEndOfNumber"] = 13)] =
    "UnexpectedEndOfNumber";
  ParseErrorCode2[(ParseErrorCode2["InvalidUnicode"] = 14)] = "InvalidUnicode";
  ParseErrorCode2[(ParseErrorCode2["InvalidEscapeCharacter"] = 15)] =
    "InvalidEscapeCharacter";
  ParseErrorCode2[(ParseErrorCode2["InvalidCharacter"] = 16)] =
    "InvalidCharacter";
})(ParseErrorCode || (ParseErrorCode = {}));

// scripts/modal.mjs
var modalControls = new Set(
  `ASYNC_WARNINGS BUILD_VALIDATION CUDA_CHECKPOINT_PATH DEFAULT_CLOUD DEV_SUFFIX DISABLE_API_PROXY ENVIRONMENT FORCE_BUILD FUNCTION_RUNTIME FUNCTION_RUNTIME_DEBUG HEARTBEAT_INTERVAL IGNORE_CACHE IMAGE_BUILDER_VERSION IMAGE_ID LOGLEVEL LOGS_TIMEOUT LOG_FORMAT LOG_PATTERN MAX_THROTTLE_WAIT OAUTH_CLIENT_ID OAUTH_CLIENT_SECRET OAUTH_JWT_KEY OAUTH_REFRESH_TOKEN OVERRIDE_HEADERS PAYLOAD_FORMAT RESTORE_STATE_PATH RUNTIME_PERF_RECORD SANDBOX_CHANNEL_IDLE_TIMEOUT SANDBOX_V2 SERVER_URL SERVE_TIMEOUT SNAPSHOT_DEBUG SYNC_ENTRYPOINT TASK_ID TOKEN_ID TOKEN_SECRET TRACEBACK USE_CONTROL_PLANE_SIDECAR_CREATE VOLUME_BLOCK_READ_TIMEOUT WORKER_ID CONFIG_PATH PROFILE IS_REMOTE`
    .split(" ")
    .map((name) => `MODAL_${name}`),
);
var slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var controlName =
  /(?:^|_)(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|ACCESS_KEY)(?:_|$)/;
function object(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Modal ${label} must be an object`);
  if (keys && Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error(`Modal ${label} has unknown fields`);
}
function text(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value))
    throw new Error(`Modal ${label} is invalid`);
}
function relative(value, label) {
  text(value, /^(?:\.|[A-Za-z0-9_.][A-Za-z0-9_.\/-]*)$/, label);
  if (value.split("/").includes(".."))
    throw new Error(`Modal ${label} must not traverse parents`);
}
function variable(name) {
  text(name, /^[A-Z][A-Z0-9_]*$/, "variable name");
  if (
    controlName.test(name) ||
    modalControls.has(name) ||
    /^(?:HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|SSL_CERT_FILE|SSL_CERT_DIR|REQUESTS_CA_BUNDLE|CURL_CA_BUNDLE)$/.test(
      name,
    ) ||
    /^(?:PATH|HOME|SHELL|ENV|BASH_ENV|IFS|CDPATH|NODE_OPTIONS|NODE_PATH|VIRTUAL_ENV|MODAL_ENVIRONMENT|MODAL_CONFIG_PATH|MODAL_PROFILE)$/.test(
      name,
    ) ||
    /^(?:PYTHON|PIP_|LD_|DYLD_|GITHUB_|ACTIONS_|RUNNER_)/.test(name)
  )
    throw new Error(
      "Modal variables must not override control configuration or credentials",
    );
}
function validateModalPolicy(policy) {
  object(
    policy,
    [
      "schemaVersion",
      "workingDirectory",
      "entrypoint",
      "pythonVersion",
      "image",
      "targets",
    ],
    "policy",
  );
  if (policy.schemaVersion !== 1)
    throw new Error("Modal schemaVersion must equal 1");
  relative(policy.workingDirectory, "workingDirectory");
  relative(policy.entrypoint, "entrypoint");
  if (!policy.entrypoint.endsWith(".py"))
    throw new Error("Modal entrypoint must name a Python file");
  text(policy.pythonVersion, /^3\.(?:10|11|12|13|14)$/, "pythonVersion");
  object(
    policy.image,
    ["repository", "repositoryVariable", "tagVariable"],
    "image",
  );
  text(
    policy.image.repository,
    /^[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[0-9]+)?\/[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/,
    "image.repository",
  );
  for (const name of [
    policy.image.repositoryVariable,
    policy.image.tagVariable,
  ])
    variable(name);
  if (policy.image.repositoryVariable === policy.image.tagVariable)
    throw new Error("Modal image variable names must differ");
  object(policy.targets, null, "targets");
  if (
    Object.keys(policy.targets).length < 1 ||
    Object.keys(policy.targets).length > 16
  )
    throw new Error("Modal requires 1-16 targets");
  for (const [name, target] of Object.entries(policy.targets)) {
    text(name, slug, "target name");
    object(target, ["githubEnvironment", "variables"], "target");
    text(
      target.githubEnvironment,
      /^[A-Za-z0-9][A-Za-z0-9_. -]{0,254}$/,
      "githubEnvironment",
    );
    if (/^preview(?:-|$)/i.test(target.githubEnvironment))
      throw new Error("Modal preview-specific environments are forbidden");
    object(target.variables, null, "variables");
    if (Object.keys(target.variables).length > 64)
      throw new Error("Modal supports at most 64 public variables per target");
    for (const [key, value] of Object.entries(target.variables)) {
      variable(key);
      if (
        [policy.image.repositoryVariable, policy.image.tagVariable].includes(
          key,
        )
      )
        throw new Error(
          "Modal image variables cannot overlap target variables",
        );
      text(value, /^[^\x00-\x1f\x7f]{1,4096}$/, "variable value");
    }
  }
  return policy;
}
function inside(root, relativePath, label) {
  relative(relativePath, label);
  let current = fs.realpathSync(root);
  for (const part of relativePath.split("/")) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink())
      throw new Error(`Modal ${label} must not contain symlinks`);
  }
  return current;
}
function loadModalPolicy(root, policyPath = ".github/modal-policy.jsonc") {
  const file = inside(root, policyPath, "policy path");
  if (!file.endsWith(".jsonc"))
    throw new Error("Modal policy path must name a .jsonc file");
  const errors = [];
  const tree = parseTree2(fs.readFileSync(file, "utf8"), errors, {
    allowTrailingComma: true,
  });
  if (errors.length || !tree) throw new Error("Modal policy is invalid JSONC");
  function rejectDuplicates(node) {
    if (node.type === "object") {
      const names = node.children.map((property) => property.children[0].value);
      if (new Set(names).size !== names.length)
        throw new Error("Modal policy has duplicate keys");
    }
    for (const child of node.children ?? []) rejectDuplicates(child);
  }
  rejectDuplicates(tree);
  return validateModalPolicy(getNodeValue2(tree));
}
function assertReviewedSource(
  root,
  { eventName, ref, defaultBranch, sourceSha },
) {
  if (!["push", "workflow_dispatch"].includes(eventName))
    throw new Error(
      "Modal deployment requires push or workflow_dispatch, never PR events",
    );
  text(ref, /^refs\/(?:heads|tags)\/[^\s]+$/, "source ref");
  text(sourceSha, /^[0-9a-f]{40}$/, "source SHA");
  text(defaultBranch, /^[A-Za-z0-9_][A-Za-z0-9_.\/-]*$/, "default branch");
  const git = (...args) =>
    spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (git("check-ref-format", `refs/heads/${defaultBranch}`).status !== 0)
    throw new Error("Modal default branch is invalid");
  const head = git("rev-parse", "HEAD");
  if (head.status !== 0 || head.stdout.trim() !== sourceSha)
    throw new Error("Modal checkout does not match the invocation SHA");
  if (
    git(
      "merge-base",
      "--is-ancestor",
      sourceSha,
      `refs/remotes/origin/${defaultBranch}`,
    ).status !== 0
  )
    throw new Error(
      "Modal source must be reviewed: an ancestor of the protected default branch",
    );
}
function deployModal(plan, { python, tokenId, tokenSecret }) {
  if (
    typeof tokenId !== "string" ||
    !tokenId.trim() ||
    typeof tokenSecret !== "string" ||
    !tokenSecret.trim()
  )
    throw new Error(
      "Modal credentials MODAL_TOKEN_ID and MODAL_TOKEN_SECRET are required",
    );
  for (const name of Object.keys(plan.variables)) variable(name);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "burnt-modal-"));
  try {
    const result = spawnSync(
      python,
      ["-m", "modal", "deploy", plan.entrypoint],
      {
        cwd: plan.cwd,
        stdio: "inherit",
        env: {
          PATH: process.env.PATH,
          LANG: "C.UTF-8",
          HOME: home,
          PYTHONNOUSERSITE: "1",
          MODAL_CONFIG_PATH: path.join(home, "modal.toml"),
          ...plan.variables,
          MODAL_TOKEN_ID: tokenId,
          MODAL_TOKEN_SECRET: tokenSecret,
        },
      },
    );
    if (result.error || result.status !== 0)
      throw new Error("Modal deploy failed");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}
function resolveModalDeployment(root, policy, target, imageTag) {
  validateModalPolicy(policy);
  if (!Object.hasOwn(policy.targets, target))
    throw new Error("Modal target does not exist");
  text(imageTag, /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/, "image tag (required)");
  const cwd = inside(root, policy.workingDirectory, "workingDirectory");
  if (!fs.statSync(cwd).isDirectory())
    throw new Error("Modal workingDirectory must be a directory");
  const entrypoint = inside(cwd, policy.entrypoint, "entrypoint");
  if (!fs.statSync(entrypoint).isFile())
    throw new Error("Modal entrypoint must be a file");
  return {
    cwd,
    entrypoint,
    pythonVersion: policy.pythonVersion,
    githubEnvironment: policy.targets[target].githubEnvironment,
    variables: {
      ...policy.targets[target].variables,
      [policy.image.repositoryVariable]: policy.image.repository,
      [policy.image.tagVariable]: imageTag,
    },
  };
}

// scripts/modal-cli.mjs
try {
  const command = process2.argv[2];
  if (process2.argv.length !== 3 || !["plan", "deploy"].includes(command))
    throw new Error("Modal command must be plan or deploy");
  const root = process2.cwd();
  assertReviewedSource(root, {
    eventName: process2.env.SOURCE_EVENT,
    ref: process2.env.SOURCE_REF,
    defaultBranch: process2.env.DEFAULT_BRANCH,
    sourceSha: process2.env.SOURCE_SHA,
  });
  const policy = loadModalPolicy(
    root,
    process2.env.MODAL_POLICY_PATH || void 0,
  );
  const plan = resolveModalDeployment(
    root,
    policy,
    process2.env.MODAL_TARGET,
    process2.env.MODAL_IMAGE_TAG,
  );
  if (command === "plan") {
    if (!process2.env.GITHUB_OUTPUT)
      throw new Error("Modal GITHUB_OUTPUT is required");
    fs2.appendFileSync(
      process2.env.GITHUB_OUTPUT,
      `plan=${JSON.stringify({ githubEnvironment: plan.githubEnvironment, pythonVersion: plan.pythonVersion })}
`,
    );
  } else {
    deployModal(plan, {
      python: process2.env.MODAL_PYTHON,
      tokenId: process2.env.MODAL_TOKEN_ID,
      tokenSecret: process2.env.MODAL_TOKEN_SECRET,
    });
  }
} catch (error) {
  process2.stderr.write(`${error.message}
`);
  process2.exitCode = 1;
}
