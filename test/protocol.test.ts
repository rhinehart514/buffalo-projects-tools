import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createBuffaloServer } from "../src/server.js";

test("exposes the complete workflow through MCP", async (context) => {
  const server = createBuffaloServer();
  const client = new Client({ name: "buffalo-test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  context.after(async () => {
    await client.close();
    await server.close();
  });

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name).sort(),
    [
      "buffalo.get_opportunity",
      "buffalo.prepare_registration",
      "buffalo.review_submission",
      "buffalo.search_opportunities",
    ],
  );

  const result = await client.callTool({
    name: "buffalo.search_opportunities",
    arguments: {
      description: "A Buffalo startup building climate software",
      goal: "accelerator and mentoring",
      kinds: ["accelerator"],
    },
  });
  const first = (
    result as { content: Array<{ type: string; text?: string }> }
  ).content[0];
  assert.equal(first?.type, "text");
  if (first?.type !== "text" || typeof first.text !== "string") {
    throw new Error("Expected text tool output");
  }
  const payload = JSON.parse(first.text) as {
    notice: string;
    matches: Array<{ id: string }>;
  };

  assert.match(payload.notice, /not eligibility decisions/);
  assert.ok(payload.matches.some((match) => match.id === "launch-ny"));

  const prompts = await client.listPrompts();
  assert.ok(prompts.prompts.some((prompt) => prompt.name === "register-in-buffalo"));
});
