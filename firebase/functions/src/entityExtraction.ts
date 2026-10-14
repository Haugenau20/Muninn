// functions/src/entityExtraction.ts
import * as functions from "firebase-functions/v2/https";
import { HttpsError } from "firebase-functions/v2/https";
import {getFirestore} from "firebase-admin/firestore";
import OpenAI from "openai";
import {rethrowHttpsError} from "./shared/httpsErrors";
import {dropPartyCharacters, partyPrompt, readPartyNames} from "./partyCharacters";
import {USAGE_PERIODS} from "./extractionAllowance";
import {
  EntityExtractionUsage,
  UsageStatus,
  exhaustedPeriod,
  nextResets,
  readUsage,
  resetElapsedPeriods,
  storedCounters,
  usageStatusOf,
} from "./extractionUsage";

// Types matching your existing OpenAI types
interface ExtractEntitiesRequest {
  content: string;
  /**
   * The group the note was written in. Its members and their characters are the party,
   * and are kept out of the result (T019). Optional so an older client still
   * works; without it nothing is excluded.
   */
  groupId?: string;
}

/**
 * The model this function calls, and the only one it will call.
 *
 * This used to be `request.data.model`, defaulting to `gpt-3.5-turbo` -- a
 * value chosen in the browser and passed to OpenAI unchecked. A modified
 * client could name any model on the price list against this project's key,
 * bounded only by the daily counter below, so the ceiling on a compromised
 * account was roughly an order of magnitude above what the limits implied.
 * The model is not a caller's decision: it is a cost and quality decision that
 * belongs to the deployment, so it is pinned here and the request field is
 * gone rather than merely ignored.
 *
 * **Why `gpt-4.1-mini`** (T050), replacing `gpt-3.5-turbo`. Its headline output
 * rate is $1.60/1M against $1.50, which reads like a rise and is not one: this
 * call is dominated by *input* -- the ~1,500-token function schema below plus
 * the system prompt, on every request, against a note capped at 10,000
 * characters -- and input drops from $0.50 to $0.40. The schema is a fixed
 * prefix comfortably over OpenAI's 1,024-token caching minimum, so it bills at
 * the $0.10 cached rate; `gpt-3.5-turbo` had no cached rate at all. A
 * representative call is cheaper before caching and materially cheaper after.
 * **Do not re-open this from the output column alone.**
 *
 * It is deliberately **not** a `gpt-5`-family or o-series model. Those reject a
 * non-default `temperature` on chat completions, so adopting one would mean
 * dropping the `temperature: 0` below -- and determinism is worth keeping in an
 * extractor whose output is written straight into campaign records.
 */
const EXTRACTION_MODEL = "gpt-4.1-mini";

/**
 * The scale of `confidence`, told to the model in the tool schema. The client
 * shows it as a percentage of 1, so `90` would read as 9000% (AI-002).
 * `minimum`/`maximum` would say it more firmly, but whether strict mode
 * accepts them was not verified, and a schema the API rejects fails every
 * call; `isFraction` below holds the line instead.
 */
const CONFIDENCE_DESCRIPTION =
  "How sure you are that this is a real entity, " +
  "as a fraction from 0 to 1 (0.9, not 90).";

/** Whether `value` is a confidence on the 0 to 1 scale. */
function isFraction(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) &&
    value >= 0 && value <= 1;
}

/**
 * The user's usage as it stands, for display. Writes nothing.
 *
 * A period that has rolled over is shown reset, but the reset is not written
 * back: this read is not in a transaction, so writing its copy could
 * overwrite a call reserved in between (SEC-003). The next reservation
 * performs the reset, inside its transaction.
 */
async function getUserUsageStatus(userId: string): Promise<UsageStatus> {
  const userDoc = await getFirestore().collection("users").doc(userId).get();
  return usageStatusOf(userDoc.data(), new Date());
}

/**
 * Reserve one extraction: reset elapsed periods, check every limit, and count
 * the call, all in one transaction.
 *
 * It used to read, check and then write a copy outside any transaction, so
 * calls racing for the last slot were all admitted and each wrote the same
 * incremented count -- four calls spent one slot and recorded one use
 * (SEC-003). The paid model call stays outside: a transaction can be retried,
 * and a retry must never call the model twice.
 */
async function checkAndUpdateUsage(userId: string): Promise<UsageStatus> {
  const db = getFirestore();
  const userRef = db.collection("users").doc(userId);

  return db.runTransaction(async (transaction) => {
    const at = new Date();
    const usageData = readUsage((await transaction.get(userRef)).data(), at);

    if (usageData.isUnlimited) {
      return {usage: usageData, limitExceeded: false, nextReset: nextResets()};
    }

    const now = at.toISOString();
    let needsUpdate = resetElapsedPeriods(usageData, now);
    const exceededPeriod = exhaustedPeriod(usageData);

    if (exceededPeriod === undefined) {
      usageData.daily.count++;
      usageData.weekly.count++;
      usageData.monthly.count++;
      usageData.lastExtraction = now;
      needsUpdate = true;
    }

    if (needsUpdate) {
      transaction.set(userRef, storedCounters(usageData), {merge: true});
    }

    return {
      usage: usageData,
      limitExceeded: exceededPeriod !== undefined,
      exceededPeriod,
      nextReset: nextResets()
    };
  });
}

/**
 * Give back a call `checkAndUpdateUsage` counted, for a call the model never
 * served. A period that has reset since the reservation is left alone: the
 * call was counted in a window that is gone.
 *
 * @param userId The caller
 * @param reserved The usage as the reservation left it
 */
async function releaseUsage(userId: string, reserved: EntityExtractionUsage): Promise<void> {
  if (reserved.isUnlimited) return;
  const db = getFirestore();
  const userRef = db.collection("users").doc(userId);

  await db.runTransaction(async (transaction) => {
    const usageData = readUsage((await transaction.get(userRef)).data(), new Date());
    let changed = false;
    for (const period of USAGE_PERIODS) {
      const now = usageData[period];
      if (now.lastReset === reserved[period].lastReset && now.count > 0) {
        now.count--;
        changed = true;
      }
    }
    if (changed) {
      transaction.set(userRef, storedCounters(usageData), {merge: true});
    }
  });
}

/**
 * Whether OpenAI refused the call because the account has no credit left.
 * A rate limit is also a 429, but carries another code and passes.
 */
function isOutOfCredit(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    (error as {code?: unknown}).code === "insufficient_quota";
}

/**
 * Get usage status without any API calls or counter increments
 * Use this for UI display purposes only
 */
export const getUsageStatus = functions.onCall(
  {
    region: "europe-west1",
  },
  async (request: functions.CallableRequest) => {
    try {
      // Check authentication
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "Unauthorized");
      }

      const userId = request.auth.uid;

      // Get usage status without incrementing anything
      const usageStatus = await getUserUsageStatus(userId);
      
      return {
        success: true,
        usage: usageStatus
      };

    } catch (error) {
      console.error("Get usage status error:", error);

      rethrowHttpsError(error, "Failed to get usage status");
    }
  }
);

/**
 * Extract entities and increment usage when calling OpenAI
 */
export const extractEntities = functions.onCall(
  {
    region: "europe-west1",
    secrets: ["OPENAI_API_KEY"], // Secret for API key
  },
  async (request: functions.CallableRequest<ExtractEntitiesRequest>) => {
    try {
      // Check authentication
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "Unauthorized");
      }

      const userId = request.auth.uid;
      // The model is `EXTRACTION_MODEL`, never anything the caller sent.
      const { content, groupId } = request.data;

      // Validate input BEFORE checking usage
      if (!content || typeof content !== "string") {
        throw new HttpsError("invalid-argument", "Content is required");
      }

      if (content.length > 10000) {
        throw new HttpsError("invalid-argument", "Content too long (max 10000 characters)");
      }

      if (groupId !== undefined && (typeof groupId !== "string" || !groupId)) {
        throw new HttpsError("invalid-argument", "groupId must be a non-empty string");
      }

      // Before usage is counted: a caller outside the group is refused here,
      // and should not be charged an extraction for it.
      const partyNames = groupId ?
        await readPartyNames(getFirestore(), groupId, userId) :
        [];

      // Check usage limits and increment counters (only if we're going to call OpenAI)
      const usageStatus = await checkAndUpdateUsage(userId);
      
      if (usageStatus.limitExceeded) {
        throw new HttpsError("resource-exhausted", "USAGE_LIMIT_EXCEEDED", {
          usage: usageStatus,
          contactInfo: {
            message: "You've reached your smart detection limit. Contact us to request an increase.",
            contactUrl: "/contact",
            prefilledSubject: "Smart Detection Limit Increase Request"
          }
        });
      }

      // Initialize OpenAI client with secret
      const openaiApiKey = process.env.OPENAI_API_KEY;
      if (!openaiApiKey) {
        console.error("OpenAI API key not configured");
        throw new HttpsError("internal", "Service not configured");
      }

      const openai = new OpenAI({
        apiKey: openaiApiKey,
      });

      // Your existing system prompt and function definitions
      const systemPrompt = `
You are a Dungeons & Dragons session-note parser.
Your *only* job is to call the function "extract_entities" with valid arguments.

The function schema strictly defines the allowed 'type' field as one of:
  - "npc"
  - "location"
  - "quest"
  - "rumor"

**Never** use any other value (e.g. "character", "person", etc.).  
Every named person or character is ALWAYS type "npc".
${partyPrompt(partyNames)}
For a quest, "relatedNPCNames" is the *names* of the people involved, exactly
as the note writes them. You have never seen this campaign's records and have
no identifiers for anyone; do not invent any.

Do not output any text yourself—*only* invoke the function with correct JSON.
`;

      // Copy your functions array from openaiFunctions.ts here
      /*
        Structured Outputs, not the legacy `functions` array.

        This was a `functions` / `function_call` pair, deprecated since 2023 in
        favour of `tools` / `tool_choice`, and with it the schema below was only
        ever a *hint*: the model was free to return a shape that did not match,
        and several of T050's losses are exactly that -- a field arriving in a
        form the consumer did not expect. `strict: true` makes the schema a
        guarantee instead, which is worth more here than anywhere else in the
        product, because what comes back is written into campaign records.

        Three things strict mode requires, each of which changed something:
          - `anyOf`, never `oneOf`. The four entity variants used `oneOf`,
            which strict mode rejects outright.
          - every property listed in `required`. Optionality is expressed as a
            nullable type instead, so the model must *say* it found no race
            rather than quietly omitting the key. Consumers already treat null
            and absent alike (`extraData.race || undefined`), so this is a
            schema change with no behaviour change downstream.
          - `enum: ["npc"]` rather than `const: "npc"` for the discriminators.
      */
      const extractionTool = {
          type: "function" as const,
          function: {
          name: "extract_entities",
          description: "Extract D&D entities from a session note",
          strict: true,
          parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
              entities: {
              type: "array",
              items: {
                  anyOf: [
                  {
                      // NPC schema
                      type: "object",
                      additionalProperties: false,
                      properties: {
                          type: { enum: ["npc"] },
                          text: { type: "string" },
                          confidence: { type: "number", description: CONFIDENCE_DESCRIPTION },
                          name: { type: "string" },
                          title: { type: ["string", "null"] },
                          race: { type: ["string", "null"] },
                          occupation: { type: ["string", "null"] },
                          location: { type: ["string", "null"] },
                          relationship: {
                          type: ["string", "null"],
                          enum: ["friendly", "neutral", "hostile", "unknown", null]
                          },
                          description: { type: ["string", "null"] },
                          context: { type: "string" }
                      },
                      required: [
                          "type",
                          "text",
                          "confidence",
                          "name",
                          "title",
                          "race",
                          "occupation",
                          "location",
                          "relationship",
                          "description",
                          "context"
                      ]
                      },
                      {
                      // Location schema
                      type: "object",
                      additionalProperties: false,
                      properties: {
                          type: { enum: ["location"] },
                          text: { type: "string" },
                          confidence: { type: "number", description: CONFIDENCE_DESCRIPTION },
                          name: { type: "string" },
                          locationType: {
                          type: "string",
                          enum: [
                              "region",
                              "city",
                              "town",
                              "village",
                              "dungeon",
                              "landmark",
                              "building",
                              "poi"
                          ]
                          },
                          description: { type: ["string", "null"] },
                          /*
                            Prose -- "The Ashen Vale" -- never an id, whatever the
                            name suggests. `convertEntity` assigns it straight
                            to `parentId` today, which writes a dangling
                            reference and files the place under "Unplaced".
                            Still true as of this commit; T050 resolves it.
                          */
                          parentLocation: { type: ["string", "null"] },
                          context: { type: "string" }
                      },
                      required: [
                          "type",
                          "text",
                          "confidence",
                          "name",
                          "locationType",
                          "description",
                          "parentLocation",
                          "context"
                      ]
                      },
                      {
                      // Quest schema
                      type: "object",
                      additionalProperties: false,
                      properties: {
                          type: { enum: ["quest"] },
                          text: { type: "string" },
                          confidence: { type: "number", description: CONFIDENCE_DESCRIPTION },
                          title: { type: "string" },
                          description: { type: ["string", "null"] },
                          objectives: {
                          type: "array",
                          items: { type: "string" }
                          },
                          /*
                            Names, and named as such. This asked for
                            `relatedNPCIds` for as long as nobody noticed the
                            model has never seen the NPC directory and has no
                            ids to give -- so it answered with names under an
                            id-shaped key, `QuestContext` stored them verbatim,
                            and every one of them resolved to nothing on the
                            quest card. Resolving names to ids is this side's
                            job (`resolveCarriedNames`); the model's job is to
                            say who it read about.
                          */
                          relatedNPCNames: {
                          type: "array",
                          items: { type: "string" }
                          },
                          locationName: { type: ["string", "null"] }
                      },
                      required: [
                          "type",
                          "text",
                          "confidence",
                          "title",
                          "description",
                          "objectives",
                          "relatedNPCNames",
                          "locationName"
                      ]
                      },
                      {
                      // Rumor schema
                      type: "object",
                      additionalProperties: false,
                      properties: {
                          type: { enum: ["rumor"] },
                          text: { type: "string" },
                          confidence: { type: "number", description: CONFIDENCE_DESCRIPTION },
                          title: { type: "string" },
                          content: { type: "string" },
                          // No "unknown": `RumorStatus` in the app has three
                          // members, and a rumour nobody has verified is what
                          // "unconfirmed" already names. Offering a fourth
                          // produced documents the rumours list could not
                          // group, which dropped the row silently. The client
                          // whitelists this too (NoteContext), for notes
                          // already extracted under the old schema.
                          status: {
                          type: ["string", "null"],
                          enum: ["confirmed", "unconfirmed", "false", null]
                          },
                          // Null is a real answer, not a gap: "heard from none
                          // of the other four" (`15-9`). The client leaves it
                          // unset rather than coercing it to "other".
                          sourceType: {
                          type: ["string", "null"],
                          enum: ["npc", "tavern", "notice", "traveler", "other", null]
                          },
                          sourceName: { type: ["string", "null"] }
                      },
                      required: [
                          "type",
                          "text",
                          "confidence",
                          "title",
                          "content",
                          "status",
                          "sourceType",
                          "sourceName"
                      ]
                      }
                  ]
              }
              }
          },
          required: ["entities"]
          }
          }
      };

      // Make OpenAI API call (this is where the cost occurs)
      const response = await openai.chat.completions.create({
        model: EXTRACTION_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: content }
        ],
        tools: [extractionTool],
        // Not "auto" and not "required": this call has exactly one tool and
        // exactly one acceptable answer, so name it. The old `function_call`
        // did the same thing under the deprecated spelling.
        tool_choice: { type: "function", function: { name: "extract_entities" } },
        temperature: 0
      }).catch(async (error: unknown) => {
        // The account is prepaid with no top-up: when it runs dry every call
        // fails here until it is topped up. Say so, and do not charge the
        // caller for a call that was never served (T129).
        if (!isOutOfCredit(error)) throw error;
        console.error("OpenAI has no credit left; extraction is paused.");
        await releaseUsage(userId, usageStatus.usage);
        throw new HttpsError("unavailable", "AI_EXTRACTION_PAUSED");
      });

      const choice = response.choices?.[0];
      if (!choice) {
        throw new Error("No response from OpenAI");
      }

      /*
        `tool_calls`, not `function_call`. A refusal is checked first and
        separately: with Structured Outputs the model can decline in a typed
        `refusal` field rather than by returning a malformed argument object,
        and reading that as "no tool call" would report a deliberate refusal as
        a transport failure.
      */
      const msg = choice.message;
      if (msg.refusal) {
        throw new Error(`Model refused the extraction: ${msg.refusal}`);
      }

      const toolCall = msg.tool_calls?.[0];
      if (!toolCall || toolCall.type !== "function" ||
          toolCall.function.name !== "extract_entities") {
        throw new Error("Unexpected function call");
      }

      const rawArgs = toolCall.function.arguments;
      if (!rawArgs) {
        throw new Error("No arguments in function call");
      }

      // Parse and return the entities with usage info
      const parsedResponse = JSON.parse(rawArgs);

      // A confidence off the 0-1 scale is not reinterpreted: `90` may mean
      // 0.9 or may not, and a guessed score would outrank a real one when the
      // client picks between duplicates. The detection is dropped (AI-002).
      const entities =
        (parsedResponse.entities ?? []) as Array<{confidence?: unknown}>;
      const scored = entities.filter((entity) => isFraction(entity.confidence));
      if (scored.length < entities.length) {
        console.warn(
          `Dropped ${entities.length - scored.length} detection(s) ` +
            "with a confidence off the 0-1 scale."
        );
      }

      return {
        success: true,
        entities: dropPartyCharacters(
          scored as typeof parsedResponse.entities,
          partyNames
        ),
        usage: usageStatus
      };

    } catch (error) {
      console.error("Entity extraction error:", error);

      rethrowHttpsError(error, "Failed to extract entities");
    }
  }
);