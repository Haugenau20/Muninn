/*
 * Verify the extraction call: the model is pinned server-side, and the request
 * uses Structured Outputs rather than the deprecated `functions` array. (T050)
 *
 *   cd firebase/functions && npm run build && node scripts/verify-model-pin.js
 *
 * Exits 0 only if BOTH cases below behave. Not wired into any CI gate, because
 * this package has none -- run it after touching the OpenAI call.
 *
 * `firebase/functions` has no jest, so this stands in for one. It invokes the
 * compiled callable directly via `.run()`, with `openai` and `firebase-admin`
 * intercepted, and records which model actually reached the OpenAI SDK.
 *
 * It runs TWO cases, because a script that only exercises the new code proves
 * the new code runs, not that it changed anything:
 *   FIXED   -- lib/entityExtraction.js as built
 *   CONTROL -- the same file with the old `request.data.model` behaviour
 *              patched back in, which MUST show the injected model
 */
const Module = require("module");
const fs = require("fs");
const path = require("path");

// Resolved from this file, not hard-coded, so the script survives a clone
// anywhere. `scripts/` sits directly under the functions package root.
const FN_DIR = path.resolve(__dirname, "..");
const BUILT = path.join(FN_DIR, "lib/entityExtraction.js");

let recordedModel = null;
let recordedArgs = null;

class FakeOpenAI {
  constructor() {
    this.chat = {
      completions: {
        create: async (args) => {
          recordedModel = args.model;
          recordedArgs = args;
          return {
            choices: [{
              message: {
                // Structured Outputs answer here, not `function_call`. A stub
                // still returning the deprecated shape would make the reader
                // below look fine while the real API broke it.
                tool_calls: [{
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "extract_entities",
                    arguments: JSON.stringify({ entities: [] }),
                  },
                }],
              },
            }],
          };
        },
      },
    };
  }
}
FakeOpenAI.default = FakeOpenAI;

const fakeAdmin = {
  initializeApp: () => {},
  apps: [{}],
  firestore: () => ({
    collection: () => ({
      doc: () => ({
        get: async () => ({
          exists: true,
          data: () => ({ entityExtractionUsage: { isUnlimited: true } }),
        }),
        set: async () => {},
      }),
    }),
  }),
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "openai") return FakeOpenAI;
  if (request === "firebase-admin" || request === "firebase-admin/app") return fakeAdmin;
  return origLoad.apply(this, arguments);
};

process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
process.env.GCLOUD_PROJECT = "demo-test";

async function runCase(label, sourcePath) {
  recordedModel = null;
  delete require.cache[require.resolve(sourcePath)];
  const mod = require(sourcePath);
  const res = await mod.extractEntities.run({
    auth: { uid: "user-1", token: {} },
    data: { content: "Odile met Vesk in Cinderford.", model: "gpt-5.2-pro" },
    rawRequest: { headers: {} },
  });
  console.log(`  ${label}: model sent to OpenAI = ${JSON.stringify(recordedModel)}` +
              `  (success=${res && res.success})`);
  return recordedModel;
}

(async () => {
  console.log("\nInjecting  model: 'gpt-5.2-pro'  ($21/$168 per 1M) in the request payload.\n");

  const fixed = await runCase("FIXED  ", BUILT);

  // Build the control: restore `const { content, model = "gpt-3.5-turbo" } = request.data`
  const src = fs.readFileSync(BUILT, "utf8");
  const controlSrc = src
    .replace('const { content } = request.data;',
             'const { content, model = "gpt-3.5-turbo" } = request.data;')
    .replace('model: EXTRACTION_MODEL,', 'model: model,');
  if (controlSrc === src) {
    console.log("  CONTROL: could not patch old behaviour back in -- script is stale.");
    process.exit(2);
  }
  // Must live beside the original so its `firebase-functions` import resolves.
  const controlPath = path.join(FN_DIR, "lib", "entityExtraction.control.js");
  fs.writeFileSync(controlPath, controlSrc);
  const control = await runCase("CONTROL", controlPath);
  fs.unlinkSync(controlPath);

  // ---- call shape, on the FIXED build ----
  await runCase("SHAPE  ", BUILT);
  const a = recordedArgs || {};
  const tool = (a.tools || [])[0] || {};
  const fn = tool.function || {};
  const params = fn.parameters || {};
  const variants = ((params.properties || {}).entities || {}).items || {};
  const shape = {
    "uses tools, not the deprecated `functions`":
      Array.isArray(a.tools) && a.functions === undefined,
    "names the one tool via tool_choice":
      a.tool_choice && a.tool_choice.function &&
      a.tool_choice.function.name === "extract_entities" &&
      a.function_call === undefined,
    "asks for strict: true": fn.strict === true,
    "uses anyOf, which strict requires (oneOf is rejected)":
      Array.isArray(variants.anyOf) && variants.oneOf === undefined,
    "keeps temperature: 0": a.temperature === 0,
    // gpt-6-luna refuses a function tool on chat completions without it (T155)
    "turns reasoning off (reasoning_effort: none)": a.reasoning_effort === "none",
  };
  // strict also demands every property be listed in `required`
  const notRequired = [];
  (variants.anyOf || []).forEach((v, i) => {
    const props = Object.keys(v.properties || {});
    const req = v.required || [];
    props.forEach((k) => { if (!req.includes(k)) notRequired.push(`variant ${i}: ${k}`); });
  });
  shape["every property is required (strict's rule)"] = notRequired.length === 0;

  console.log("");
  Object.keys(shape).forEach((k) => {
    console.log(`  ${shape[k] ? "PASS" : "FAIL"}  ${k}`);
  });
  if (notRequired.length) console.log("        missing from required: " + notRequired.join(", "));
  const okShape = Object.keys(shape).every((k) => shape[k]);

  console.log("");
  const okFixed = fixed === "gpt-6-luna";
  const okControl = control === "gpt-5.2-pro";
  console.log(`  FIXED   pinned to gpt-6-luna .................. ${okFixed ? "PASS" : "FAIL"}`);
  console.log(`  CONTROL took the injected model (proves the`);
  console.log(`          script would have caught a regression) ${okControl ? "PASS" : "FAIL"}`);
  process.exit(okFixed && okControl && okShape ? 0 : 1);
})().catch((e) => { console.error("ERROR:", e && e.message); process.exit(3); });
