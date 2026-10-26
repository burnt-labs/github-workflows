/* eslint-disable */

// scripts/env-json.mjs
import fs from "node:fs";
import path2 from "node:path";

// scripts/policy.mjs
import path from "node:path";

// node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/scanner.js
function createScanner(text, ignoreTrivia = false) {
  const len = text.length;
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
      let ch = text.charCodeAt(pos);
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
    if (text.charCodeAt(pos) === 48) {
      pos++;
    } else {
      pos++;
      while (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
      }
    }
    if (pos < text.length && text.charCodeAt(pos) === 46) {
      pos++;
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
      } else {
        scanError = 3;
        return text.substring(start, pos);
      }
    }
    let end = pos;
    if (
      pos < text.length &&
      (text.charCodeAt(pos) === 69 || text.charCodeAt(pos) === 101)
    ) {
      pos++;
      if (
        (pos < text.length && text.charCodeAt(pos) === 43) ||
        text.charCodeAt(pos) === 45
      ) {
        pos++;
      }
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
        end = pos;
      } else {
        scanError = 3;
      }
    }
    return text.substring(start, end);
  }
  function scanString() {
    let result = "",
      start = pos;
    while (true) {
      if (pos >= len) {
        result += text.substring(start, pos);
        scanError = 2;
        break;
      }
      const ch = text.charCodeAt(pos);
      if (ch === 34) {
        result += text.substring(start, pos);
        pos++;
        break;
      }
      if (ch === 92) {
        result += text.substring(start, pos);
        pos++;
        if (pos >= len) {
          scanError = 2;
          break;
        }
        const ch2 = text.charCodeAt(pos++);
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
          result += text.substring(start, pos);
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
    let code = text.charCodeAt(pos);
    if (isWhiteSpace(code)) {
      do {
        pos++;
        value += String.fromCharCode(code);
        code = text.charCodeAt(pos);
      } while (isWhiteSpace(code));
      return (token = 15);
    }
    if (isLineBreak(code)) {
      pos++;
      value += String.fromCharCode(code);
      if (code === 13 && text.charCodeAt(pos) === 10) {
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
        if (text.charCodeAt(pos + 1) === 47) {
          pos += 2;
          while (pos < len) {
            if (isLineBreak(text.charCodeAt(pos))) {
              break;
            }
            pos++;
          }
          value = text.substring(start, pos);
          return (token = 12);
        }
        if (text.charCodeAt(pos + 1) === 42) {
          pos += 2;
          const safeLength = len - 1;
          let commentClosed = false;
          while (pos < safeLength) {
            const ch = text.charCodeAt(pos);
            if (ch === 42 && text.charCodeAt(pos + 1) === 47) {
              pos += 2;
              commentClosed = true;
              break;
            }
            pos++;
            if (isLineBreak(ch)) {
              if (ch === 13 && text.charCodeAt(pos) === 10) {
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
          value = text.substring(start, pos);
          return (token = 13);
        }
        value += String.fromCharCode(code);
        pos++;
        return (token = 16);
      // numbers
      case 45:
        value += String.fromCharCode(code);
        pos++;
        if (pos === len || !isDigit(text.charCodeAt(pos))) {
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
          code = text.charCodeAt(pos);
        }
        if (tokenOffset !== pos) {
          value = text.substring(tokenOffset, pos);
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
function parse(text, errors = [], options = ParseOptions.DEFAULT) {
  let currentProperty = null;
  let currentParent = [];
  const previousParents = [];
  function onValue(value) {
    if (Array.isArray(currentParent)) {
      currentParent.push(value);
    } else if (currentProperty !== null) {
      currentParent[currentProperty] = value;
    }
  }
  const visitor = {
    onObjectBegin: () => {
      const object2 = {};
      onValue(object2);
      previousParents.push(currentParent);
      currentParent = object2;
      currentProperty = null;
    },
    onObjectProperty: (name) => {
      currentProperty = name;
    },
    onObjectEnd: () => {
      currentParent = previousParents.pop();
    },
    onArrayBegin: () => {
      const array = [];
      onValue(array);
      previousParents.push(currentParent);
      currentParent = array;
      currentProperty = null;
    },
    onArrayEnd: () => {
      currentParent = previousParents.pop();
    },
    onLiteralValue: onValue,
    onError: (error, offset, length) => {
      errors.push({ error, offset, length });
    },
  };
  visit(text, visitor, options);
  return currentParent[0];
}
function visit(text, visitor, options = ParseOptions.DEFAULT) {
  const _scanner = createScanner(text, false);
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
var parse2 = parse;
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
function printParseErrorCode(code) {
  switch (code) {
    case 1:
      return "InvalidSymbol";
    case 2:
      return "InvalidNumberFormat";
    case 3:
      return "PropertyNameExpected";
    case 4:
      return "ValueExpected";
    case 5:
      return "ColonExpected";
    case 6:
      return "CommaExpected";
    case 7:
      return "CloseBraceExpected";
    case 8:
      return "CloseBracketExpected";
    case 9:
      return "EndOfFileExpected";
    case 10:
      return "InvalidCommentToken";
    case 11:
      return "UnexpectedEndOfComment";
    case 12:
      return "UnexpectedEndOfString";
    case 13:
      return "UnexpectedEndOfNumber";
    case 14:
      return "InvalidUnicode";
    case 15:
      return "InvalidEscapeCharacter";
    case 16:
      return "InvalidCharacter";
  }
  return "<unknown ParseErrorCode>";
}

// scripts/policy.mjs
var TOPOLOGIES = {
  standard: { candidate: "staging", release: "production" },
  chain: { candidate: "testnet", release: "mainnet" },
  single: null,
};
function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (value !== value.trim()) {
    throw new Error(`${label} must not contain surrounding whitespace`);
  }
}
function parseJsonc(source, sourceName) {
  const errors = [];
  const value = parse2(source, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length) {
    const details = errors
      .map(({ error, offset }) => `${printParseErrorCode(error)} at ${offset}`)
      .join(", ");
    throw new Error(`${sourceName} is invalid JSONC: ${details}`);
  }
  return value;
}
function validateDeploymentPolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error("deployment policy must be an object");
  }
  if (policy.schemaVersion !== 1) {
    throw new Error("deployment schemaVersion must equal 1");
  }
  if (!(policy.topology in TOPOLOGIES)) {
    throw new Error("deployment topology must be standard, chain, or single");
  }
  if (!["manual", "automatic"].includes(policy.promotionMode)) {
    throw new Error("promotionMode must be manual or automatic");
  }
  if (!["npm", "pnpm", "yarn"].includes(policy.packageManager)) {
    throw new Error("packageManager must be npm, pnpm, or yarn");
  }
  requireString(policy.workingDirectory, "deployment workingDirectory");
  requireString(policy.versionFile, "deployment versionFile");
  if (policy.containers === void 0) {
    policy.containers = false;
  } else if (typeof policy.containers !== "boolean") {
    throw new Error("deployment containers must be a boolean");
  }
  if (policy.releasePrefix === void 0) {
    policy.releasePrefix = "";
  } else if (
    typeof policy.releasePrefix !== "string" ||
    (policy.releasePrefix !== "" &&
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(policy.releasePrefix))
  ) {
    throw new Error(
      "deployment releasePrefix must be empty or a lowercase letters-and-numbers slug",
    );
  }
  const single = policy.topology === "single";
  if (policy.workerSecrets === void 0) {
    policy.workerSecrets = [];
  } else if (!Array.isArray(policy.workerSecrets)) {
    throw new Error("deployment workerSecrets must be an array");
  } else {
    const seen = /* @__PURE__ */ new Set();
    for (const name of policy.workerSecrets) {
      requireString(name, "deployment workerSecrets entry");
      if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
        throw new Error(
          `deployment workerSecrets entry ${name} must be an uppercase environment-variable name`,
        );
      }
      if (seen.has(name)) {
        throw new Error(`deployment workerSecrets lists ${name} twice`);
      }
      seen.add(name);
    }
    for (const reserved of [
      "BURNT_CLOUDFLARE_API_TOKEN",
      "BURNT_CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_API_TOKEN",
      "CLOUDFLARE_ACCOUNT_ID",
      "GITHUB_TOKEN",
    ]) {
      if (seen.has(reserved)) {
        throw new Error(
          `deployment workerSecrets must not include ${reserved}: that is the deployment credential`,
        );
      }
    }
  }
  if (policy.environmentSecret === void 0) policy.environmentSecret = "";
  if (
    typeof policy.environmentSecret !== "string" ||
    (policy.environmentSecret !== "" &&
      !/^[A-Z][A-Z0-9_]*$/.test(policy.environmentSecret))
  )
    throw new Error(
      "deployment environmentSecret must be an uppercase secret name",
    );
  if (policy.workerVariables === void 0) policy.workerVariables = [];
  if (!Array.isArray(policy.workerVariables))
    throw new Error("deployment workerVariables must be an array");
  const variables = /* @__PURE__ */ new Set();
  for (const name of policy.workerVariables) {
    requireString(name, "deployment workerVariables entry");
    if (!/^[A-Z][A-Z0-9_]*$/.test(name))
      throw new Error(
        "deployment workerVariables entries must be uppercase environment-variable names",
      );
    if (variables.has(name))
      throw new Error(`deployment workerVariables lists ${name} twice`);
    if (policy.workerSecrets.includes(name))
      throw new Error(`deployment variable and secret names overlap: ${name}`);
    variables.add(name);
  }
  const controlNames = /* @__PURE__ */ new Set([
    "BURNT_CLOUDFLARE_API_TOKEN",
    "BURNT_CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_KEY",
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "GH_VARIABLES_TOKEN",
    "BURNT_PAT_GITHUB_ACTIONS_TOKEN",
    "PHALA_CLOUD_API_KEY",
    "BURNT_PROD_PHALA_API_KEY",
    "GHCR_READ_TOKEN",
    "DSTACK_DOCKER_REGISTRY",
    "DSTACK_DOCKER_USERNAME",
    "DSTACK_DOCKER_PASSWORD",
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
    "ACTIONS_RUNTIME_TOKEN",
  ]);
  if (policy.environmentSecret) {
    for (const name of [
      ...policy.workerVariables,
      ...policy.workerSecrets,
      policy.environmentSecret,
    ]) {
      if (controlNames.has(name))
        throw new Error(
          "deployment runtime configuration must not name a control credential",
        );
    }
  }
  if (!policy.environmentSecret && policy.workerVariables.length)
    throw new Error("deployment workerVariables requires environmentSecret");
  if (
    policy.environmentSecret &&
    [...policy.workerVariables, ...policy.workerSecrets].includes(
      policy.environmentSecret,
    )
  ) {
    throw new Error(
      "deployment environmentSecret must not also be runtime configuration",
    );
  }
  if (policy.verificationSecrets === void 0) policy.verificationSecrets = [];
  if (!Array.isArray(policy.verificationSecrets))
    throw new Error("deployment verificationSecrets must be an array");
  if (policy.verificationSecrets.length && !policy.environmentSecret)
    throw new Error("verificationSecrets requires environmentSecret");
  const verification = /* @__PURE__ */ new Set();
  for (const name of policy.verificationSecrets) {
    if (!policy.workerSecrets.includes(name) || controlNames.has(name))
      throw new Error(
        "verificationSecrets must contain only declared runtime workerSecrets",
      );
    if (verification.has(name))
      throw new Error("verificationSecrets must not contain duplicates");
    verification.add(name);
  }
  if (policy.d1Migrations === void 0) {
    policy.d1Migrations = [];
  } else if (!Array.isArray(policy.d1Migrations)) {
    throw new Error("deployment d1Migrations must be an array");
  } else {
    const seen = /* @__PURE__ */ new Set();
    for (const name of policy.d1Migrations) {
      requireString(name, "deployment d1Migrations entry");
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
        throw new Error(
          `deployment d1Migrations entry ${name} must be a D1 binding or database name`,
        );
      }
      if (seen.has(name)) {
        throw new Error(`deployment d1Migrations lists ${name} twice`);
      }
      seen.add(name);
    }
  }
  if (policy.previewReleaseOnMain === void 0) {
    policy.previewReleaseOnMain = !single;
  } else if (typeof policy.previewReleaseOnMain !== "boolean") {
    throw new Error("deployment previewReleaseOnMain must be a boolean");
  } else if (single && policy.previewReleaseOnMain) {
    throw new Error(
      "single topology cannot set previewReleaseOnMain: candidate and release are the same Worker",
    );
  }
  const expected = TOPOLOGIES[policy.topology];
  for (const role of ["candidate", "release"]) {
    const target = policy.targets?.[role];
    if (!target || typeof target !== "object") {
      throw new Error(`deployment targets.${role} must be an object`);
    }
    for (const field of ["githubEnvironment", "url"]) {
      requireString(target[field], `deployment targets.${role}.${field}`);
    }
    if (single) {
      if (target.wranglerEnv !== void 0) {
        throw new Error(
          `single topology forbids targets.${role}.wranglerEnv: the Worker has no wrangler environment`,
        );
      }
    } else {
      requireString(
        target.wranglerEnv,
        `deployment targets.${role}.wranglerEnv`,
      );
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(target.wranglerEnv)) {
        throw new Error(
          `targets.${role}.wranglerEnv must be a lowercase letters-and-numbers slug`,
        );
      }
      if (target.githubEnvironment !== expected[role]) {
        throw new Error(
          `${policy.topology} topology requires targets.${role}.githubEnvironment=${expected[role]}`,
        );
      }
    }
    if (policy.verificationSecrets.length && !target.commands?.afterDeploy) {
      throw new Error(
        `verificationSecrets requires targets.${role}.commands.afterDeploy`,
      );
    }
    if (policy.environmentSecret && target.wranglerConfig === void 0) {
      throw new Error(
        `environmentSecret requires targets.${role}.wranglerConfig`,
      );
    }
    if (target.wranglerConfig !== void 0) {
      requireString(target.wranglerConfig, `targets.${role}.wranglerConfig`);
      if (
        !/^[A-Za-z0-9_.\/-]+\.jsonc?$/.test(target.wranglerConfig) ||
        path.isAbsolute(target.wranglerConfig) ||
        target.wranglerConfig.split("/").includes("..")
      ) {
        throw new Error(
          `targets.${role}.wranglerConfig must be a relative JSON/JSONC path without parent traversal`,
        );
      }
    }
    if (target.commands !== void 0) {
      if (
        !target.commands ||
        typeof target.commands !== "object" ||
        Array.isArray(target.commands)
      ) {
        throw new Error(`targets.${role}.commands must be an object`);
      }
      for (const [name, command] of Object.entries(target.commands)) {
        if (!["prepare", "afterDeploy"].includes(name)) {
          throw new Error(
            `targets.${role}.commands has unknown lifecycle command ${name}`,
          );
        }
        requireString(command, `targets.${role}.commands.${name}`);
      }
    }
    if (
      target.githubEnvironment === "preview" ||
      target.githubEnvironment.startsWith("preview-")
    ) {
      throw new Error("preview-specific GitHub Environments are forbidden");
    }
  }
  if (
    !single &&
    policy.targets.candidate.wranglerEnv === policy.targets.release.wranglerEnv
  ) {
    throw new Error(
      "candidate and release must use distinct Wrangler environments",
    );
  }
  if (single && policy.targets.candidate.url !== policy.targets.release.url) {
    throw new Error(
      "single topology requires targets.candidate.url and targets.release.url to match",
    );
  }
  if (
    single &&
    policy.targets.candidate.githubEnvironment !==
      policy.targets.release.githubEnvironment
  ) {
    throw new Error(
      "single topology requires targets.candidate.githubEnvironment and targets.release.githubEnvironment to match",
    );
  }
  return policy;
}

// scripts/env-json.mjs
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validateEnvironmentBundle(raw, policy) {
  let bundle;
  try {
    bundle = JSON.parse(raw);
  } catch {
    throw new Error("Environment bundle is not valid JSON");
  }
  if (
    !object(bundle) ||
    Object.keys(bundle).sort().join(",") !== "secrets,vars" ||
    !object(bundle.vars) ||
    !object(bundle.secrets)
  ) {
    throw new Error(
      "Environment bundle must contain only vars and secrets objects",
    );
  }
  for (const [section, names] of [
    ["vars", policy.workerVariables],
    ["secrets", policy.workerSecrets],
  ]) {
    if (
      Object.keys(bundle[section]).some((name) => !names.includes(name)) ||
      names.some((name) => !Object.hasOwn(bundle[section], name))
    ) {
      throw new Error(
        `Environment bundle ${section} must match the declared names exactly`,
      );
    }
    for (const value of Object.values(bundle[section])) {
      if (
        typeof value !== "string" ||
        (section === "secrets" && value.trim() === "")
      ) {
        throw new Error(
          `Environment bundle ${section} values must be ${section === "secrets" ? "nonempty strings" : "strings"}`,
        );
      }
    }
  }
  return bundle;
}
function inside(root, target) {
  const relative = path2.relative(root, target);
  if (
    relative === ".." ||
    relative.startsWith(`..${path2.sep}`) ||
    path2.isAbsolute(relative)
  ) {
    throw new Error(
      "Generated Wrangler configuration must stay inside the repository",
    );
  }
}
function configurationPaths(root, policy, target) {
  const repository = fs.realpathSync(root);
  const working = path2.resolve(repository, policy.workingDirectory);
  inside(repository, working);
  const configured = path2.resolve(working, target.wranglerConfig);
  inside(repository, configured);
  const directory = path2.dirname(configured);
  if (fs.realpathSync(directory) !== directory)
    throw new Error(
      "Generated Wrangler configuration must not use symlink paths",
    );
  const source = path2.join(directory, "wrangler.jsonc");
  if (configured === source)
    throw new Error("Refusing to overwrite source wrangler.jsonc");
  if (fs.lstatSync(source).isSymbolicLink())
    throw new Error("Source Wrangler configuration must not be a symlink");
  const destination = fs.lstatSync(configured, { throwIfNoEntry: false });
  if (destination?.isSymbolicLink())
    throw new Error("Generated Wrangler configuration must not be a symlink");
  const original = fs.statSync(source);
  if (
    destination &&
    destination.dev === original.dev &&
    destination.ino === original.ino
  )
    throw new Error("Refusing to overwrite source Wrangler configuration");
  return { source, generated: configured };
}
function inputs({ policy: rawPolicy, target, bundle, root }) {
  const policy = validateDeploymentPolicy(structuredClone(rawPolicy));
  if (!policy.environmentSecret)
    throw new Error("environmentSecret is required for bundle materialization");
  if (!["candidate", "release"].includes(target))
    throw new Error("Unknown environment bundle target");
  return {
    policy,
    selected: policy.targets[target],
    values: validateEnvironmentBundle(bundle, policy),
    root,
  };
}
function materializePublicConfiguration(options) {
  const { policy, selected, values, root } = inputs(options);
  const files = configurationPaths(root, policy, selected);
  const config = parseJsonc(
    fs.readFileSync(files.source, "utf8"),
    "source Wrangler configuration",
  );
  if (!object(config))
    throw new Error("Source Wrangler configuration must be an object");
  const scope =
    policy.topology === "single" ? config : config.env?.[selected.wranglerEnv];
  if (!object(scope))
    throw new Error(
      "Source Wrangler configuration does not contain the selected environment",
    );
  scope.vars = values.vars;
  fs.writeFileSync(
    files.generated,
    `${JSON.stringify(config, null, 2)}
`,
    {
      flag: "wx",
    },
  );
  return files.generated;
}
function removeSecretsFile(runnerTemp) {
  fs.rmSync(path2.join(runnerTemp, "worker-secrets.json"), { force: true });
}
function materializeWorkerSecrets(options) {
  const { runnerTemp, operation } = options;
  const output = path2.join(runnerTemp, "worker-secrets.json");
  try {
    removeSecretsFile(runnerTemp);
    if (operation !== "deploy")
      throw new Error("Runtime secrets may be materialized only for deploy");
    const { values } = inputs(options);
    fs.writeFileSync(
      output,
      `${JSON.stringify(values.secrets)}
`,
      {
        mode: 384,
        flag: "wx",
      },
    );
    return output;
  } catch (error) {
    removeSecretsFile(runnerTemp);
    throw error;
  }
}
function materializeVerificationSecrets(options) {
  const { runnerTemp, operation } = options;
  const output = path2.join(runnerTemp, "worker-verification-secrets.json");
  try {
    fs.rmSync(output, { force: true });
    if (operation !== "deploy")
      throw new Error(
        "Verification secrets may be materialized only after deploy",
      );
    const { policy, values } = inputs(options);
    if (!policy.verificationSecrets.length)
      throw new Error(
        "verificationSecrets is required for probe materialization",
      );
    const secrets = Object.fromEntries(
      policy.verificationSecrets.map((name) => [name, values.secrets[name]]),
    );
    fs.writeFileSync(
      output,
      `${JSON.stringify(secrets)}
`,
      {
        mode: 384,
        flag: "wx",
      },
    );
    return output;
  } catch (error) {
    fs.rmSync(output, { force: true });
    throw error;
  }
}

// scripts/env-json-cli.mjs
try {
  const options = {
    policy: JSON.parse(process.env.DEPLOYMENT_POLICY),
    target: process.env.TARGET,
    bundle: process.env.ENVIRONMENT_JSON,
    root: process.env.GITHUB_WORKSPACE,
    runnerTemp: process.env.RUNNER_TEMP,
    operation: process.env.OPERATION,
  };
  if (process.argv[2] === "prepare") materializePublicConfiguration(options);
  else if (process.argv[2] === "secrets") materializeWorkerSecrets(options);
  else if (process.argv[2] === "verification")
    materializeVerificationSecrets(options);
  else throw new Error("Unknown environment bundle operation");
} catch {
  process.stderr.write(
    "Environment bundle materialization failed; verify its schema, declared keys and generated configuration path.\n",
  );
  process.exitCode = 1;
}
