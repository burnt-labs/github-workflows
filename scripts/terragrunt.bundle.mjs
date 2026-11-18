/* eslint-disable */

// scripts/terragrunt-cli.mjs
import crypto2 from "node:crypto";
import fs2 from "node:fs";
import path2 from "node:path";
import process from "node:process";

// scripts/terragrunt.mjs
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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
    let code2 = text2.charCodeAt(pos);
    if (isWhiteSpace(code2)) {
      do {
        pos++;
        value += String.fromCharCode(code2);
        code2 = text2.charCodeAt(pos);
      } while (isWhiteSpace(code2));
      return (token = 15);
    }
    if (isLineBreak(code2)) {
      pos++;
      value += String.fromCharCode(code2);
      if (code2 === 13 && text2.charCodeAt(pos) === 10) {
        pos++;
        value += "\n";
      }
      lineNumber++;
      tokenLineStartOffset = pos;
      return (token = 14);
    }
    switch (code2) {
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
        value += String.fromCharCode(code2);
        pos++;
        return (token = 16);
      // numbers
      case 45:
        value += String.fromCharCode(code2);
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
        while (pos < len && isUnknownContentCharacter(code2)) {
          pos++;
          code2 = text2.charCodeAt(pos);
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
        value += String.fromCharCode(code2);
        pos++;
        return (token = 16);
    }
  }
  function isUnknownContentCharacter(code2) {
    if (isWhiteSpace(code2) || isLineBreak(code2)) {
      return false;
    }
    switch (code2) {
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

// scripts/terragrunt.mjs
var slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var semver = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
var secretName = /^[A-Z_][A-Z0-9_]{0,127}$/;
var variableName = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
var roleArn = /^arn:aws:iam::\d{12}:role\/[A-Za-z0-9+=,.@_\/-]{1,512}$/;
var region = /^[a-z]{2}(?:-gov|-iso[a-z]*)?-[a-z]+-\d$/;
var environment = /^[A-Za-z0-9][A-Za-z0-9_. -]{0,254}$/;
var maxListedChanges = 50;
function object(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Terragrunt ${label} must be an object`);
  if (keys && Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error(`Terragrunt ${label} has unknown fields`);
}
function text(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value))
    throw new Error(`Terragrunt ${label} is invalid`);
}
function optionalBoolean(value, fallback, label) {
  if (value === void 0) return fallback;
  if (typeof value !== "boolean")
    throw new Error(`Terragrunt ${label} must be a boolean`);
  return value;
}
function relative(value, label) {
  text(value, /^(?:\.|[A-Za-z0-9_.][A-Za-z0-9_.\/-]*)$/, label);
  if (value.split("/").includes(".."))
    throw new Error(`Terragrunt ${label} must not traverse parents`);
}
function githubEnvironment(value, label) {
  text(value, environment, label);
  if (/^preview(?:-|$)/i.test(value))
    throw new Error("Terragrunt preview-specific environments are forbidden");
}
function variableSecrets(value, label) {
  if (value === void 0) return {};
  object(value, null, label);
  const entries = Object.entries(value);
  if (entries.length > 32)
    throw new Error(`Terragrunt ${label} supports at most 32 variables`);
  for (const [name, secret] of entries) {
    text(name, variableName, `${label} variable name`);
    text(secret, secretName, `${label} secret name`);
    if (/^(?:GITHUB_|ACTIONS_|RUNNER_)/.test(secret))
      throw new Error(`Terragrunt ${label} cannot read GitHub-reserved names`);
  }
  return { ...value };
}
function stage(value, label, keys) {
  object(value, keys, label);
  githubEnvironment(value.githubEnvironment, `${label}.githubEnvironment`);
  text(value.awsRoleArn, roleArn, `${label}.awsRoleArn`);
  return {
    githubEnvironment: value.githubEnvironment,
    awsRoleArn: value.awsRoleArn,
    variableSecrets: variableSecrets(
      value.variableSecrets,
      `${label}.variableSecrets`,
    ),
  };
}
function validateTerragruntPolicy(policy) {
  object(policy, ["schemaVersion", "stacks"], "policy");
  if (policy.schemaVersion !== 1)
    throw new Error("Terragrunt schemaVersion must equal 1");
  object(policy.stacks, null, "stacks");
  const names = Object.keys(policy.stacks);
  if (names.length < 1 || names.length > 32)
    throw new Error("Terragrunt requires 1-32 stacks");
  const stacks = {};
  for (const name of names) {
    text(name, slug, "stack name");
    const stack = policy.stacks[name];
    object(
      stack,
      ["workingDirectory", "awsRegion", "credentials", "plan", "apply"],
      `stack ${name}`,
    );
    relative(stack.workingDirectory, `${name}.workingDirectory`);
    text(stack.awsRegion, region, `${name}.awsRegion`);
    let cloudflareApiTokenSecret = null;
    if (stack.credentials !== void 0) {
      object(
        stack.credentials,
        ["cloudflareApiTokenSecret"],
        `${name}.credentials`,
      );
      text(
        stack.credentials.cloudflareApiTokenSecret,
        secretName,
        `${name}.credentials.cloudflareApiTokenSecret`,
      );
      cloudflareApiTokenSecret = stack.credentials.cloudflareApiTokenSecret;
    }
    const plan = stage(stack.plan, `${name}.plan`, [
      "githubEnvironment",
      "awsRoleArn",
      "variableSecrets",
      "lock",
      "failOnDestroyOrReplace",
    ]);
    plan.lock = optionalBoolean(stack.plan.lock, true, `${name}.plan.lock`);
    plan.failOnDestroyOrReplace = optionalBoolean(
      stack.plan.failOnDestroyOrReplace,
      true,
      `${name}.plan.failOnDestroyOrReplace`,
    );
    const apply = stage(stack.apply, `${name}.apply`, [
      "githubEnvironment",
      "awsRoleArn",
      "variableSecrets",
    ]);
    if (plan.githubEnvironment === apply.githubEnvironment)
      throw new Error(
        "Terragrunt plan and apply must use distinct GitHub Environments",
      );
    for (const secrets of [plan.variableSecrets, apply.variableSecrets])
      if (Object.values(secrets).includes(cloudflareApiTokenSecret))
        throw new Error(
          "Terragrunt variableSecrets cannot forward the Cloudflare credential",
        );
    stacks[name] = {
      workingDirectory: stack.workingDirectory,
      awsRegion: stack.awsRegion,
      cloudflareApiTokenSecret,
      plan,
      apply,
    };
  }
  return { schemaVersion: 1, stacks };
}
function inside(root, relativePath, label) {
  relative(relativePath, label);
  let current = fs.realpathSync(root);
  if (relativePath === ".") return current;
  for (const part of relativePath.split("/")) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink())
      throw new Error(`Terragrunt ${label} must not contain symlinks`);
  }
  return current;
}
function loadTerragruntPolicy(
  root,
  policyPath = ".github/terragrunt-policy.jsonc",
) {
  const file = inside(root, policyPath, "policy path");
  if (!file.endsWith(".jsonc"))
    throw new Error("Terragrunt policy path must name a .jsonc file");
  const errors = [];
  const tree = parseTree2(fs.readFileSync(file, "utf8"), errors, {
    allowTrailingComma: true,
  });
  if (errors.length || !tree)
    throw new Error("Terragrunt policy is invalid JSONC");
  (function rejectDuplicates(node) {
    if (node.type === "object") {
      const names = node.children.map((property) => property.children[0].value);
      if (new Set(names).size !== names.length)
        throw new Error("Terragrunt policy has duplicate keys");
    }
    for (const child of node.children ?? []) rejectDuplicates(child);
  })(tree);
  return validateTerragruntPolicy(getNodeValue2(tree));
}
function readToolVersion(root, workingDirectory, file) {
  const top = fs.realpathSync(root);
  let current = inside(root, workingDirectory, "workingDirectory");
  if (!fs.statSync(current).isDirectory())
    throw new Error("Terragrunt workingDirectory must be a directory");
  for (;;) {
    const candidate = path.join(current, file);
    if (fs.existsSync(candidate)) {
      if (fs.lstatSync(candidate).isSymbolicLink())
        throw new Error(`Terragrunt ${file} must not be a symlink`);
      const version = fs.readFileSync(candidate, "utf8").trim();
      text(version, semver, file);
      return version;
    }
    if (current === top) break;
    current = path.dirname(current);
  }
  throw new Error(`Terragrunt requires ${file} in the stack or above it`);
}
function resolveStack(root, policy, name) {
  text(name, slug, "stack input");
  if (!Object.hasOwn(policy.stacks, name))
    throw new Error("Terragrunt stack is not declared in the policy");
  const stack = policy.stacks[name];
  return {
    stack: name,
    ...stack,
    terraformVersion: readToolVersion(
      root,
      stack.workingDirectory,
      ".terraform-version",
    ),
    terragruntVersion: readToolVersion(
      root,
      stack.workingDirectory,
      ".terragrunt-version",
    ),
  };
}
function assertInvocation(
  flow,
  { eventName, ref, defaultBranch, allowDestroy },
) {
  if (flow === "pr") {
    if (eventName !== "pull_request")
      throw new Error("Terragrunt PR flow runs on pull_request only");
    if (allowDestroy)
      throw new Error("Terragrunt PR flow cannot allow destroy");
    return;
  }
  if (flow !== "main") throw new Error("Terragrunt flow must be pr or main");
  if (!["push", "workflow_dispatch"].includes(eventName))
    throw new Error(
      "Terragrunt main flow requires push or workflow_dispatch, never PR events",
    );
  text(defaultBranch, /^[A-Za-z0-9_][A-Za-z0-9_.\/-]*$/, "default branch");
  if (ref !== `refs/heads/${defaultBranch}`)
    throw new Error("Terragrunt applies only the default branch");
  if (allowDestroy && eventName !== "workflow_dispatch")
    throw new Error(
      "Terragrunt allow-destroy is accepted only on a manual workflow_dispatch",
    );
}
var actionsOf = (change) => change?.change?.actions ?? [];
function classify(change) {
  const actions = actionsOf(change);
  const key = actions.join(",");
  if (key === "delete,create" || key === "create,delete") return "replace";
  if (key === "delete") return "destroy";
  if (key === "create") return "add";
  if (key === "update") return "change";
  if (key === "forget") return "forget";
  if (key === "no-op" || key === "read" || key === "") return null;
  return "unknown";
}
function mask(value, sensitive) {
  if (sensitive === true) return "(sensitive)";
  if (Array.isArray(value))
    return value.map((item, index) =>
      mask(item, Array.isArray(sensitive) ? sensitive[index] : false),
    );
  if (value && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort())
      result[key] = mask(
        value[key],
        sensitive && typeof sensitive === "object" ? sensitive[key] : false,
      );
    return result;
  }
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value === void 0 ? null : value);
}
function summarizePlan(plan) {
  object(plan, null, "plan JSON");
  if (
    typeof plan.format_version !== "string" ||
    !/^1\./.test(plan.format_version)
  )
    throw new Error("Terragrunt plan JSON format is unsupported");
  if (plan.errored === true)
    throw new Error("Terragrunt plan errored; nothing can be applied");
  const resourceChanges = Array.isArray(plan.resource_changes)
    ? plan.resource_changes
    : [];
  const counts = {
    add: 0,
    change: 0,
    destroy: 0,
    replace: 0,
    import: 0,
    forget: 0,
    unknown: 0,
  };
  const changes = [];
  const fingerprintChanges = [];
  for (const change of resourceChanges) {
    if (typeof change?.address !== "string")
      throw new Error("Terragrunt plan JSON has a change without an address");
    const kind = classify(change);
    const importing = Boolean(change.change?.importing);
    if (kind) counts[kind] += 1;
    if (importing) counts.import += 1;
    if (kind || importing)
      changes.push({
        address: change.address,
        action: kind ?? "import",
        importing,
      });
    fingerprintChanges.push({
      address: change.address,
      previous_address: change.previous_address ?? null,
      actions: actionsOf(change),
      action_reason: change.action_reason ?? null,
      before: mask(change.change?.before, change.change?.before_sensitive),
      after: mask(change.change?.after, change.change?.after_sensitive),
      after_unknown: change.change?.after_unknown ?? null,
      replace_paths: change.change?.replace_paths ?? null,
      importing: change.change?.importing ?? null,
    });
  }
  const outputChanges = {};
  let outputsChanged = 0;
  for (const [name, change] of Object.entries(plan.output_changes ?? {})) {
    const actions = change?.actions ?? [];
    if (!(actions.length === 1 && actions[0] === "no-op")) outputsChanged += 1;
    outputChanges[name] = {
      actions,
      before: mask(change?.before, change?.before_sensitive),
      after: mask(change?.after, change?.after_sensitive),
      after_unknown: change?.after_unknown ?? null,
    };
  }
  fingerprintChanges.sort((a, b) => (a.address < b.address ? -1 : 1));
  const fingerprint = crypto
    .createHash("sha256")
    .update(
      canonical({
        resource_changes: fingerprintChanges,
        output_changes: outputChanges,
      }),
    )
    .digest("hex");
  const destructive = changes
    .filter((change) =>
      ["destroy", "replace", "unknown"].includes(change.action),
    )
    .map((change) => change.address);
  return {
    counts,
    outputsChanged,
    changes,
    destructive,
    hasChanges: changes.length > 0 || outputsChanged > 0,
    fingerprint,
  };
}
function code(value) {
  return `\`${String(value).replace(/[`\r\n]/g, "")}\``;
}
function renderSummary(
  summary,
  { stack, workingDirectory, sha, runUrl, heading },
) {
  const { counts } = summary;
  const lines = [
    `### ${heading}: ${code(stack)}`,
    "",
    `Working directory ${code(workingDirectory)} at ${code(sha)}.`,
    "",
    "| Add | Change | Destroy | Replace | Import | Forget | Outputs |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    `| ${counts.add} | ${counts.change} | ${counts.destroy} | ${counts.replace} | ${counts.import} | ${counts.forget} | ${summary.outputsChanged} |`,
    "",
  ];
  if (summary.destructive.length)
    lines.push(
      `**This plan destroys or replaces ${summary.destructive.length} resource(s).**`,
      "",
    );
  if (!summary.hasChanges) lines.push("No changes.", "");
  else if (summary.changes.length) {
    lines.push("| Action | Address |", "| --- | --- |");
    for (const change of summary.changes.slice(0, maxListedChanges))
      lines.push(
        `| ${change.action}${change.importing && change.action !== "import" ? " (import)" : ""} | ${code(change.address)} |`,
      );
    if (summary.changes.length > maxListedChanges)
      lines.push(
        "",
        `${summary.changes.length - maxListedChanges} more change(s) are in the run log.`,
      );
    lines.push("");
  }
  lines.push(
    `Plan fingerprint ${code(summary.fingerprint.slice(0, 16))}. [Run](${runUrl})`,
  );
  return lines.join("\n");
}
function credentialEnvironment(
  resolved,
  stageName,
  { allSecrets, namedCloudflareToken, base },
) {
  const stageConfig = resolved[stageName];
  let secrets = {};
  if (allSecrets) {
    try {
      secrets = JSON.parse(allSecrets);
    } catch {
      throw new Error("Terragrunt secrets context is not JSON");
    }
  }
  const env = {};
  for (const name of [
    "PATH",
    "HOME",
    "TMPDIR",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
  ])
    if (base[name]) env[name] = base[name];
  if (
    !env.AWS_ACCESS_KEY_ID ||
    !env.AWS_SECRET_ACCESS_KEY ||
    !env.AWS_SESSION_TOKEN
  )
    throw new Error(
      "Terragrunt requires the AWS OIDC session; the role was not assumed",
    );
  env.AWS_REGION = resolved.awsRegion;
  env.AWS_DEFAULT_REGION = resolved.awsRegion;
  env.TF_IN_AUTOMATION = "1";
  env.TG_NON_INTERACTIVE = "true";
  env.TG_DISABLE_BUCKET_UPDATE = "true";
  const masks = [];
  if (resolved.cloudflareApiTokenSecret) {
    const token =
      namedCloudflareToken || secrets[resolved.cloudflareApiTokenSecret];
    if (typeof token !== "string" || !token.trim())
      throw new Error(
        `Terragrunt Cloudflare credential ${resolved.cloudflareApiTokenSecret} is not set on ${stageConfig.githubEnvironment}`,
      );
    env.CLOUDFLARE_API_TOKEN = token;
    masks.push(token);
  }
  for (const [variable, secret] of Object.entries(
    stageConfig.variableSecrets,
  )) {
    const value = secrets[secret];
    if (typeof value !== "string" || !value.length)
      throw new Error(
        `Terragrunt variable secret ${secret} is not set on ${stageConfig.githubEnvironment}`,
      );
    env[`TF_VAR_${variable}`] = value;
    masks.push(value);
  }
  return { env, masks };
}
function terragrunt(
  args,
  { cwd, env, binary = "terragrunt", capture = false },
) {
  const result = spawnSync(binary, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: capture
      ? ["ignore", "pipe", "inherit"]
      : ["ignore", "inherit", "inherit"],
  });
  if (result.error || result.status !== 0)
    throw new Error(`Terragrunt ${args[0]} failed`);
  return result.stdout;
}
function planStack(root, resolved, { env, planFile, lock, binary }) {
  const cwd = inside(root, resolved.workingDirectory, "workingDirectory");
  terragrunt(["init", "-input=false", "-lockfile=readonly"], {
    cwd,
    env,
    binary,
  });
  terragrunt(
    [
      "plan",
      "-input=false",
      `-out=${planFile}`,
      ...(lock ? [] : ["-lock=false"]),
    ],
    { cwd, env, binary },
  );
  const json = terragrunt(["show", "-json", planFile], {
    cwd,
    env,
    binary,
    capture: true,
  });
  let plan;
  try {
    plan = JSON.parse(json);
  } catch {
    throw new Error("Terragrunt show -json did not return plan JSON");
  }
  return summarizePlan(plan);
}
function assertApplicable(summary, { reviewedFingerprint, allowDestroy }) {
  text(reviewedFingerprint, /^[0-9a-f]{64}$/, "reviewed plan fingerprint");
  if (summary.fingerprint !== reviewedFingerprint)
    throw new Error(
      "Terragrunt plan differs from the reviewed plan; state or config changed since it was made. Re-run the workflow.",
    );
  if (summary.destructive.length && !allowDestroy)
    throw new Error(
      `Terragrunt refuses to apply a plan that destroys or replaces: ${summary.destructive.join(", ")}`,
    );
}
function applyStack(root, resolved, { env, planFile, binary }) {
  const cwd = inside(root, resolved.workingDirectory, "workingDirectory");
  terragrunt(["apply", "-input=false", planFile], { cwd, env, binary });
}

// scripts/terragrunt-cli.mjs
function output(name, value) {
  if (!process.env.GITHUB_OUTPUT)
    throw new Error("Terragrunt GITHUB_OUTPUT is required");
  const delimiter = `EOF_${crypto2.randomBytes(16).toString("hex")}`;
  fs2.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `${name}<<${delimiter}
${value}
${delimiter}
`,
  );
}
function stepSummary(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY)
    fs2.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `${markdown}
`,
    );
}
function mask2(values) {
  for (const value of values)
    for (const line of value.split(/\r?\n/))
      if (line.trim())
        process.stdout.write(`::add-mask::${line}
`);
}
try {
  const [command, flow] = process.argv.slice(2);
  if (
    process.argv.length !== 4 ||
    !["resolve", "plan", "apply"].includes(command) ||
    !["pr", "main"].includes(flow) ||
    (command === "apply" && flow !== "main")
  )
    throw new Error(
      "Terragrunt command must be resolve|plan <pr|main> or apply main",
    );
  const root = process.cwd();
  const allowDestroy = process.env.TERRAGRUNT_ALLOW_DESTROY === "true";
  if (!["true", "false", void 0].includes(process.env.TERRAGRUNT_ALLOW_DESTROY))
    throw new Error("Terragrunt allow-destroy must be true or false");
  assertInvocation(flow, {
    eventName: process.env.SOURCE_EVENT,
    ref: process.env.SOURCE_REF,
    defaultBranch: process.env.DEFAULT_BRANCH,
    allowDestroy,
  });
  const policy = loadTerragruntPolicy(
    root,
    process.env.TERRAGRUNT_POLICY_PATH || void 0,
  );
  const resolved = resolveStack(root, policy, process.env.TERRAGRUNT_STACK);
  if (command === "resolve") {
    output(
      "stack",
      JSON.stringify({
        workingDirectory: resolved.workingDirectory,
        awsRegion: resolved.awsRegion,
        terraformVersion: resolved.terraformVersion,
        terragruntVersion: resolved.terragruntVersion,
        plan: {
          githubEnvironment: resolved.plan.githubEnvironment,
          awsRoleArn: resolved.plan.awsRoleArn,
        },
        apply: {
          githubEnvironment: resolved.apply.githubEnvironment,
          awsRoleArn: resolved.apply.awsRoleArn,
        },
      }),
    );
  } else {
    const stageName = command === "apply" ? "apply" : "plan";
    const { env, masks } = credentialEnvironment(resolved, stageName, {
      allSecrets: process.env.ALL_SECRETS,
      namedCloudflareToken: process.env.NAMED_CLOUDFLARE_API_TOKEN,
      base: process.env,
    });
    mask2(masks);
    if (!process.env.RUNNER_TEMP)
      throw new Error("Terragrunt RUNNER_TEMP is required");
    const planFile = path2.join(
      process.env.RUNNER_TEMP,
      `terragrunt-${resolved.stack}.tfplan`,
    );
    const summary = planStack(root, resolved, {
      env,
      planFile,
      lock: command === "apply" ? true : resolved.plan.lock,
    });
    const markdown = renderSummary(summary, {
      stack: resolved.stack,
      workingDirectory: resolved.workingDirectory,
      sha: process.env.SOURCE_SHA,
      runUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
      heading:
        command === "apply" ? "Terragrunt apply plan" : "Terragrunt plan",
    });
    stepSummary(markdown);
    if (command === "plan") {
      output("summary", markdown);
      output("fingerprint", summary.fingerprint);
      output("has-changes", String(summary.hasChanges));
      output("destructive", String(summary.destructive.length > 0));
      if (
        summary.destructive.length &&
        resolved.plan.failOnDestroyOrReplace &&
        !allowDestroy
      )
        throw new Error(
          `Terragrunt plan destroys or replaces: ${summary.destructive.join(", ")}`,
        );
    } else {
      assertApplicable(summary, {
        reviewedFingerprint: process.env.REVIEWED_FINGERPRINT,
        allowDestroy,
      });
      applyStack(root, resolved, { env, planFile });
    }
  }
} catch (error) {
  process.stderr.write(`${error.message}
`);
  process.exitCode = 1;
}
