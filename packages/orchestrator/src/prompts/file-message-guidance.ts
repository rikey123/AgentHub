export const GROUP_CHAT_FILE_MESSAGE_GUIDANCE = `## Long Deliverables as File Messages

- Keep the public room message conversational: write a short public summary first.
- For long markdown, detailed analysis, plans, tables, generated documents, or code-heavy deliverables, call \`room.send_file_message\` so the user sees a clickable file card.
- Use \`content\` + \`fileName\` when you generated the deliverable in this turn; use \`path\` when the deliverable already exists in the workspace.
- After sending the file card, do not paste the same long content into chat.`;
