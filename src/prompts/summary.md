You are compressing a conversation history for continued task execution.

Generate a compact but complete summary that preserves all critical context required for the task to continue without errors.

Include:
- User's goal / problem statement
- Key decisions, assumptions, and constraints
- Important actions (files created, edited, read)
- Commands or operations executed
- Errors encountered and how they were resolved
- Current progress and next steps

Output Format (plain text only):

GOAL: <user intent>
STATE: <current progress and status>
ACTIONS: <key actions taken>
FILES: <relevant files touched>
COMMANDS: <important commands executed>
ERRORS: <errors encountered and resolutions>
NEXT: <what should happen next>

Guidelines:
- Be concise but do NOT omit critical technical details
- Preserve identifiers, filenames, port numbers, and dependencies
- Remove repetition and irrelevant conversation
- Ensure this summary can fully replace prior messages

Constraints:
1. Output ONLY plain text
2. DO NOT call any tools
3. DO NOT output JSON or markdown
4. Keep it compact but sufficiently detailed (no strict line limit)