import { streamText } from "ai";

export async function badCall() {
  return streamText({
    model: "openai/gpt-4o",
    prompt: "hello"
  });
}
