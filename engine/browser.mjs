// turri's eyes on the app it builds: browser tools for the chat's agent, on the window's preview pane - the one the
// person is looking at. A pi extension of the app's own, loaded beside turri's: each tool is a request to the main
// process, which drives the pane (electron/preview.ts). They exist only in the app: the terminal has no pane to drive.

/**
 * Tools on the preview, each sent as `request(action, params)` and answered with what came of it. What the model is
 * sent of their screenshots is kept down: only the newest is an image - those before it are a line saying they were
 * there - and none at all once the model has refused one, as some do that their catalogue says take images.
 */
export function browserExtension(request) {
  return (pi) => {
    const sees = { images: true };
    for (const tool of tools(request, sees)) pi.registerTool(tool);
    pi.on("context", ({ messages }) => ({ messages: withScreenshots(messages, sees.images) }));
    pi.on("message_end", ({ message }, ctx) => {
      if (message.role !== "assistant" || message.stopReason !== "error" || !IMAGE_REFUSED.test(message.errorMessage ?? "")) return;
      // Refused for the screenshot alone: the turn is tried again - pi retries an error that says it may be, and
      // leaves the refused attempt out - and is sent without it, so turri carries on where it was.
      const first = sees.images;
      sees.images = false;
      message.errorMessage = `${message.errorMessage}${RETRIED}`;
      if (first) ctx.ui.notify("This model does not take images: turri carries on without the preview's screenshots, and reads the page instead.", "warning");
    });
  };
}

/** A provider's refusal of an image in the conversation - Bedrock's: "This model doesn't support the image field". */
const IMAGE_REFUSED = /image/i;
const RETRIED = " - try your request again";

/** A reply refused for a screenshot and tried again without it: not the person's to see - the turn goes on. */
export function retriedWithoutImages(message) {
  return message?.role === "assistant" && message.stopReason === "error" && (message.errorMessage ?? "").endsWith(RETRIED);
}

const SCREENSHOT = "browser_screenshot";

/** The conversation as the model is sent it: the newest screenshot as an image, if it takes them, the rest as words. */
function withScreenshots(messages, images) {
  const newest = images ? messages.findLastIndex((message) => message.role === "toolResult" && message.toolName === SCREENSHOT) : -1;
  return messages.map((message, index) => {
    if (message.role !== "toolResult" || message.toolName !== SCREENSHOT || index === newest || !Array.isArray(message.content)) return message;
    const said = images ? "[an earlier screenshot of the preview, left out: take another to see it now]" : "[the screenshot is left out: this model does not take images - use browser_read]";
    return { ...message, content: message.content.map((part) => (part.type === "image" ? { type: "text", text: said } : part)) };
  });
}

const NOTHING = { type: "object", properties: {}, additionalProperties: false };
const ELEMENT = {
  ref: { type: "integer", description: "The element's number, as browser_read listed it: [3] is 3." },
  selector: { type: "string", description: "A CSS selector for the element, when it has no number." },
};

const GUIDELINES = [
  "The browser_* tools drive the preview pane in the person's window, on the app as it runs on this machine (localhost): the person watches what you do there.",
  "Use them to check what you built works as the spec says: open it, read the page, try a flow, read the console for errors.",
  "Prefer browser_read to browser_screenshot: it is text, and costs less. Take a screenshot when how the page looks matters.",
  "They see only a running app: if nothing answers, start it first (release it, or run it), then open it.",
];

function tools(request, sees) {
  const text = (value) => ({ type: "text", text: value });
  const header = (result) => `${result.title || "(untitled)"} - ${result.url}`;
  return [
    {
      name: "browser_navigate",
      label: "Open in the preview",
      description: "Open a URL of the app being built in the preview pane - one this machine serves, such as http://localhost:8000/docs. Returns the page's title and URL, or why it did not load.",
      promptSnippet: "Open the running app (localhost) in the person's preview pane",
      promptGuidelines: GUIDELINES,
      parameters: { type: "object", properties: { url: { type: "string", description: "The address, on localhost." } }, required: ["url"], additionalProperties: false },
      execute: async (_id, { url }) => {
        const result = await request("navigate", { url: /^\w+:\/\//.test(url) ? url : `http://${url}` });
        if (result.error) throw new Error(`Nothing loaded at ${url}: ${result.error}. Is the app running?`);
        return { content: [text(`Opened ${header(result)}`)], details: undefined };
      },
    },
    {
      name: "browser_screenshot",
      label: "Look at the preview",
      description: "See the page open in the preview pane, as an image - how it looks. Costs more than browser_read: take one when the look matters.",
      promptSnippet: "See the preview pane as an image",
      parameters: NOTHING,
      execute: async (_id, _params, _signal, _update, ctx) => {
        if (!sees.images || (ctx.model !== undefined && !ctx.model.input.includes("image"))) {
          sees.images = false;
          throw new Error("This model does not take images: read the page with browser_read instead.");
        }
        const result = await request("screenshot", {});
        return { content: [text(header(result)), { type: "image", data: result.data, mimeType: result.mimeType }], details: undefined };
      },
    },
    {
      name: "browser_read",
      label: "Read the preview",
      description: "Read the page open in the preview pane: its visible text, and its controls - links, buttons, inputs - each numbered for browser_click and browser_type.",
      promptSnippet: "Read the preview pane's text and numbered controls",
      parameters: NOTHING,
      execute: async () => {
        const result = await request("read", {});
        const controls = result.controls.length > 0 ? result.controls.join("\n") : "(none)";
        return { content: [text(`${header(result)}\n\n## Text\n\n${result.text}\n\n## Controls\n\n${controls}`)], details: undefined };
      },
    },
    {
      name: "browser_console",
      label: "Read the preview's console",
      description: "The preview page's console since it last loaded - its errors, warnings and logs - and any load that failed.",
      promptSnippet: "Read the preview page's console",
      parameters: NOTHING,
      execute: async () => {
        const result = await request("console", {});
        return { content: [text(`${header(result)}\n\n${result.lines.length > 0 ? result.lines.join("\n") : "(the console is empty)"}`)], details: undefined };
      },
    },
    {
      name: "browser_click",
      label: "Click in the preview",
      description: "Click an element of the preview page - by its number from browser_read, or a CSS selector - and wait for what it loads.",
      promptSnippet: "Click an element in the preview pane",
      parameters: { type: "object", properties: ELEMENT, additionalProperties: false },
      execute: async (_id, { ref, selector }) => {
        const result = await request("click", { ref, selector });
        return { content: [text(`${result.did}\nNow: ${header(result)}`)], details: undefined };
      },
    },
    {
      name: "browser_type",
      label: "Type in the preview",
      description: "Type text into an input of the preview page - by its number from browser_read, or a CSS selector - replacing what is in it; submit sends its form.",
      promptSnippet: "Type into an input in the preview pane",
      parameters: {
        type: "object",
        properties: { ...ELEMENT, text: { type: "string", description: "What to type." }, submit: { type: "boolean", description: "Send the form after typing, as Enter would." } },
        required: ["text"],
        additionalProperties: false,
      },
      execute: async (_id, { ref, selector, text: typed, submit }) => {
        const result = await request("type", { ref, selector, text: typed, submit });
        return { content: [text(`${result.did}\nNow: ${header(result)}`)], details: undefined };
      },
    },
  ];
}
