export const GROUP_CHAT_FILE_MESSAGE_GUIDANCE = `## Long Deliverables as File Messages

- Documents are optional. Most group-chat turns should be short spoken messages, not files.
- Do not create a file just because your message has a few bullets, a short list, or a teammate follow-up.
- Only create a file for a substantial deliverable: a formal proposal, implementation plan, checklist, table, review, spec, code-heavy output, or user-requested document.
- Keep the public room message conversational: say the human-facing point in one or two sentences, then mention the file only if you actually created one.
- When a file is genuinely needed, call \`room.send_file_message\` so the user sees a clickable file card.
- If you create a file, make the file a professional self-contained document with a title, clear sections, and enough detail to stand alone.
- Keep chat and document content separate: the chat explains your stance; the file contains the polished artifact.
- Not every speaker should create a document. If a prior file already covers the topic, add a short comment or cite that file instead.
- Use \`content\` + \`fileName\` when you generated the deliverable in this turn; use \`path\` when the deliverable already exists in the workspace.
- After sending the file card, do not paste the same long content into chat.`;
