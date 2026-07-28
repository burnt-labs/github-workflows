/* eslint-disable */
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) =>
  function __require() {
    try {
      return (
        mod ||
          (0, cb[__getOwnPropNames(cb)[0]])(
            (mod = { exports: {} }).exports,
            mod,
          ),
        mod.exports
      );
    } catch (e) {
      throw ((mod = 0), e);
    }
  };
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if ((from && typeof from === "object") || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, {
          get: () => from[key],
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
        });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (
  (target = mod != null ? __create(__getProtoOf(mod)) : {}),
  __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule
      ? __defProp(target, "default", { value: mod, enumerable: true })
      : target,
    mod,
  )
);
var __toCommonJS = (mod) =>
  __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/umd/main.js
var require_main = __commonJS({
  "node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/umd/main.js"(
    exports2,
    module2,
  ) {
    (function (factory) {
      if (typeof module2 === "object" && typeof module2.exports === "object") {
        var v = factory(require, exports2);
        if (v !== void 0) module2.exports = v;
      } else if (typeof define === "function" && define.amd) {
        define([
          "require",
          "exports",
          "./impl/format",
          "./impl/edit",
          "./impl/scanner",
          "./impl/parser",
        ], factory);
      }
    })(function (require2, exports3) {
      "use strict";
      Object.defineProperty(exports3, "__esModule", { value: true });
      exports3.applyEdits =
        exports3.modify =
        exports3.format =
        exports3.printParseErrorCode =
        exports3.ParseErrorCode =
        exports3.stripComments =
        exports3.visit =
        exports3.getNodeValue =
        exports3.getNodePath =
        exports3.findNodeAtOffset =
        exports3.findNodeAtLocation =
        exports3.parseTree =
        exports3.parse =
        exports3.getLocation =
        exports3.SyntaxKind =
        exports3.ScanError =
        exports3.createScanner =
          void 0;
      const formatter = require2("./impl/format");
      const edit = require2("./impl/edit");
      const scanner = require2("./impl/scanner");
      const parser = require2("./impl/parser");
      exports3.createScanner = scanner.createScanner;
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
      })(ScanError || (exports3.ScanError = ScanError = {}));
      var SyntaxKind;
      (function (SyntaxKind2) {
        SyntaxKind2[(SyntaxKind2["OpenBraceToken"] = 1)] = "OpenBraceToken";
        SyntaxKind2[(SyntaxKind2["CloseBraceToken"] = 2)] = "CloseBraceToken";
        SyntaxKind2[(SyntaxKind2["OpenBracketToken"] = 3)] = "OpenBracketToken";
        SyntaxKind2[(SyntaxKind2["CloseBracketToken"] = 4)] =
          "CloseBracketToken";
        SyntaxKind2[(SyntaxKind2["CommaToken"] = 5)] = "CommaToken";
        SyntaxKind2[(SyntaxKind2["ColonToken"] = 6)] = "ColonToken";
        SyntaxKind2[(SyntaxKind2["NullKeyword"] = 7)] = "NullKeyword";
        SyntaxKind2[(SyntaxKind2["TrueKeyword"] = 8)] = "TrueKeyword";
        SyntaxKind2[(SyntaxKind2["FalseKeyword"] = 9)] = "FalseKeyword";
        SyntaxKind2[(SyntaxKind2["StringLiteral"] = 10)] = "StringLiteral";
        SyntaxKind2[(SyntaxKind2["NumericLiteral"] = 11)] = "NumericLiteral";
        SyntaxKind2[(SyntaxKind2["LineCommentTrivia"] = 12)] =
          "LineCommentTrivia";
        SyntaxKind2[(SyntaxKind2["BlockCommentTrivia"] = 13)] =
          "BlockCommentTrivia";
        SyntaxKind2[(SyntaxKind2["LineBreakTrivia"] = 14)] = "LineBreakTrivia";
        SyntaxKind2[(SyntaxKind2["Trivia"] = 15)] = "Trivia";
        SyntaxKind2[(SyntaxKind2["Unknown"] = 16)] = "Unknown";
        SyntaxKind2[(SyntaxKind2["EOF"] = 17)] = "EOF";
      })(SyntaxKind || (exports3.SyntaxKind = SyntaxKind = {}));
      exports3.getLocation = parser.getLocation;
      exports3.parse = parser.parse;
      exports3.parseTree = parser.parseTree;
      exports3.findNodeAtLocation = parser.findNodeAtLocation;
      exports3.findNodeAtOffset = parser.findNodeAtOffset;
      exports3.getNodePath = parser.getNodePath;
      exports3.getNodeValue = parser.getNodeValue;
      exports3.visit = parser.visit;
      exports3.stripComments = parser.stripComments;
      var ParseErrorCode;
      (function (ParseErrorCode2) {
        ParseErrorCode2[(ParseErrorCode2["InvalidSymbol"] = 1)] =
          "InvalidSymbol";
        ParseErrorCode2[(ParseErrorCode2["InvalidNumberFormat"] = 2)] =
          "InvalidNumberFormat";
        ParseErrorCode2[(ParseErrorCode2["PropertyNameExpected"] = 3)] =
          "PropertyNameExpected";
        ParseErrorCode2[(ParseErrorCode2["ValueExpected"] = 4)] =
          "ValueExpected";
        ParseErrorCode2[(ParseErrorCode2["ColonExpected"] = 5)] =
          "ColonExpected";
        ParseErrorCode2[(ParseErrorCode2["CommaExpected"] = 6)] =
          "CommaExpected";
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
        ParseErrorCode2[(ParseErrorCode2["InvalidUnicode"] = 14)] =
          "InvalidUnicode";
        ParseErrorCode2[(ParseErrorCode2["InvalidEscapeCharacter"] = 15)] =
          "InvalidEscapeCharacter";
        ParseErrorCode2[(ParseErrorCode2["InvalidCharacter"] = 16)] =
          "InvalidCharacter";
      })(ParseErrorCode || (exports3.ParseErrorCode = ParseErrorCode = {}));
      function printParseErrorCode2(code) {
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
      exports3.printParseErrorCode = printParseErrorCode2;
      function format(documentText, range, options) {
        return formatter.format(documentText, range, options);
      }
      exports3.format = format;
      function modify(text, path2, value, options) {
        return edit.setProperty(text, path2, value, options);
      }
      exports3.modify = modify;
      function applyEdits(text, edits) {
        let sortedEdits = edits.slice(0).sort((a, b) => {
          const diff = a.offset - b.offset;
          if (diff === 0) {
            return a.length - b.length;
          }
          return diff;
        });
        let lastModifiedOffset = text.length;
        for (let i = sortedEdits.length - 1; i >= 0; i--) {
          let e = sortedEdits[i];
          if (e.offset + e.length <= lastModifiedOffset) {
            text = edit.applyEdit(text, e);
          } else {
            throw new Error("Overlapping edit");
          }
          lastModifiedOffset = e.offset;
        }
        return text;
      }
      exports3.applyEdits = applyEdits;
    });
  },
});

// scripts/policy.mjs
var policy_exports = {};
__export(policy_exports, {
  loadPolicies: () => loadPolicies,
  parseJsonc: () => parseJsonc,
  validateDeploymentPolicy: () => validateDeploymentPolicy,
  validateQualityPolicy: () => validateQualityPolicy,
});
module.exports = __toCommonJS(policy_exports);
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_path = __toESM(require("node:path"), 1);
var import_node_process = __toESM(require("node:process"), 1);
var import_jsonc_parser = __toESM(require_main(), 1);
var import_meta = {};
var QUALITY_PATH = ".github/quality-policy.jsonc";
var DEPLOYMENT_PATH = ".github/deployment-policy.jsonc";
var REQUIRED_COMMANDS = [
  "install",
  "lint",
  "prettier",
  "typeCheck",
  "test",
  "coverage",
  "build",
];
var TOPOLOGIES = {
  standard: { candidate: "staging", release: "production" },
  chain: { candidate: "testnet", release: "mainnet" },
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
  const value = (0, import_jsonc_parser.parse)(source, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length) {
    const details = errors
      .map(
        ({ error, offset }) =>
          `${(0, import_jsonc_parser.printParseErrorCode)(error)} at ${offset}`,
      )
      .join(", ");
    throw new Error(`${sourceName} is invalid JSONC: ${details}`);
  }
  return value;
}
function validateQualityPolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error("quality policy must be an object");
  }
  if (policy.schemaVersion !== 1) {
    throw new Error("quality schemaVersion must equal 1");
  }
  requireString(policy.workingDirectory, "quality workingDirectory");
  if (!policy.commands || typeof policy.commands !== "object") {
    throw new Error("quality commands must be an object");
  }
  for (const command of REQUIRED_COMMANDS) {
    requireString(policy.commands[command], `quality commands.${command}`);
  }
  return policy;
}
function validateDeploymentPolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error("deployment policy must be an object");
  }
  if (policy.schemaVersion !== 1) {
    throw new Error("deployment schemaVersion must equal 1");
  }
  if (!(policy.topology in TOPOLOGIES)) {
    throw new Error("deployment topology must be standard or chain");
  }
  if (!["manual", "automatic"].includes(policy.promotionMode)) {
    throw new Error("promotionMode must be manual or automatic");
  }
  if (!["npm", "pnpm", "yarn"].includes(policy.packageManager)) {
    throw new Error("packageManager must be npm, pnpm, or yarn");
  }
  requireString(policy.workingDirectory, "deployment workingDirectory");
  requireString(policy.versionFile, "deployment versionFile");
  const expected = TOPOLOGIES[policy.topology];
  for (const role of ["candidate", "release"]) {
    const target = policy.targets?.[role];
    if (!target || typeof target !== "object") {
      throw new Error(`deployment targets.${role} must be an object`);
    }
    for (const field of ["wranglerEnv", "githubEnvironment", "url"]) {
      requireString(target[field], `deployment targets.${role}.${field}`);
    }
    if (target.wranglerEnv !== expected[role]) {
      throw new Error(
        `${policy.topology} topology requires targets.${role}.wranglerEnv=${expected[role]}`,
      );
    }
    if (target.githubEnvironment !== target.wranglerEnv) {
      throw new Error(
        `targets.${role}.githubEnvironment must equal wranglerEnv`,
      );
    }
    if (
      target.githubEnvironment === "preview" ||
      target.githubEnvironment.startsWith("preview-")
    ) {
      throw new Error("preview-specific GitHub Environments are forbidden");
    }
  }
  return policy;
}
function loadPolicies(
  root = import_node_process.default.cwd(),
  deploymentRequired = false,
) {
  const qualityFile = import_node_path.default.join(root, QUALITY_PATH);
  const quality = validateQualityPolicy(
    parseJsonc(
      import_node_fs.default.readFileSync(qualityFile, "utf8"),
      qualityFile,
    ),
  );
  let deployment;
  const deploymentFile = import_node_path.default.join(root, DEPLOYMENT_PATH);
  if (deploymentRequired || import_node_fs.default.existsSync(deploymentFile)) {
    deployment = validateDeploymentPolicy(
      parseJsonc(
        import_node_fs.default.readFileSync(deploymentFile, "utf8"),
        deploymentFile,
      ),
    );
  }
  return { quality, deployment };
}
function writeOutput(name, value) {
  if (!import_node_process.default.env.GITHUB_OUTPUT) {
    throw new Error("GITHUB_OUTPUT is required");
  }
  import_node_fs.default.appendFileSync(
    import_node_process.default.env.GITHUB_OUTPUT,
    `${name}=${value}
`,
  );
}
function main() {
  const deploymentRequired =
    import_node_process.default.argv.includes("--deployment");
  const { quality, deployment } = loadPolicies(
    import_node_process.default.env.POLICY_ROOT ??
      import_node_process.default.cwd(),
    deploymentRequired,
  );
  writeOutput("quality", JSON.stringify(quality));
  if (deployment) {
    writeOutput("deployment", JSON.stringify(deployment));
    writeOutput("promotion-mode", deployment.promotionMode);
  }
}
if (import_meta.url === `file://${import_node_process.default.argv[1]}`) {
  try {
    main();
  } catch (error) {
    import_node_process.default.stderr.write(`${error.message}
`);
    import_node_process.default.exitCode = 1;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 &&
  (module.exports = {
    loadPolicies,
    parseJsonc,
    validateDeploymentPolicy,
    validateQualityPolicy,
  });
