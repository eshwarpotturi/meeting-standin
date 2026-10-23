# AI stand-in for meetings

## v1: chat only (23 Oct 2026)

It listens to the Meet captions. When someone asks you a question by name, it answers in the **Meet chat**. No face, no voice, and it does not touch your camera or microphone. Every message starts with `[AI stand-in for Eswar]`, and the first one says it is an AI.

Why chat only: Anand's feedback was to drop the face (people trust it less the more human it looks) and the voice (the timing is hard), and to use chat as the output. A slide-style answer on the camera is the next step (v2).

### Use it (Straive laptop, no extension needed)

1. Start the relay, as before: `brain-test\relay.ps1` (it holds the LLM Foundry key; the page never sees it).
2. Join the Meet call and switch on captions.
3. Open the browser console on the Meet tab (F12) and paste the whole of `standin-chat.js`.
4. A small pill at the bottom-left says **AI stand-in: listening**. Use **Pause** to stop it.
5. Test without a second person: type `standin.ask("Eswar, did the report go out?")` in the console.

`standin.chatCheck()` tells you whether it can find the Meet chat box. Rebuild the file after editing: `npm run build:chat`.

### What it does with a question

| Heard | Action |
|---|---|
| A yes/no question to you, answer clear from your notes (confidence 75 or more) | Posts "Yes." or "No." and a one-line reason |
| A yes/no question, not sure | Posts "I will confirm after the meeting." |
| An open question ("walk us through...") | Posts the same held line |
| A question for someone else, or no question | Says nothing |
| The same question again within 15 seconds | Says nothing |

### Tested

`node test/chat.mjs` runs 31 checks on a mock Meet page (same page rules as Meet): ignores other people, answers, holds, labels every message, no duplicates, pause and resume, sending by button and by Enter, camera and microphone untouched. All pass. The earlier 35 end-to-end checks and 70 detection checks still pass.

**Not yet tested on live Meet.** The mock uses the labels I expect (`Chat with everyone`, `Send a message`). If Meet has changed them, `standin.chatCheck()` shows it and `extension/`-free fixes are in `chat-v1/chat.js`.

### Not in v1

- Reading Anand's caption file (`tools.s-anand.net/meetcaptions`) instead of the page. It would help if Meet changes its layout.
- Open requests such as "do some research and get back to me".
- Slide-style answers on the camera (v2).

---

## v0: avatar and voice (22 Oct 2026)

A Chrome extension that sends a **labelled AI stand-in** to your Google Meet call. When someone asks you a yes/no question, it answers for you: the avatar nods or shakes its head and says a short reason. If it is not sure, it says it will confirm after the meeting.

The tile always says **AI stand-in**, and the first reply says so out loud. It is not built to pass as the real person.

Demo page: _not published yet_

## Status

| Part | State |
|---|---|
| Fake camera (dummy avatar: idle, nod, shake) | Built and tested |
| Fake mic (dummy voice) | Built and tested. The voice is not words yet; it shows timing and level. Real voice needs a voice service |
| Spots questions meant for you | Built and tested on 70 labelled lines |
| Claude brain and confidence gate | Built. Tested with a mock, not with a real key |
| Reads Meet captions | Built, tested on a stand-in page. **Not tested on live Meet** |
| Phone override (Yes/No on your phone) | Not built |
| Your own recorded clips instead of the dummy avatar | Not built (swap-in planned) |

## Install (Chrome or Edge)

1. Open `chrome://extensions` and switch on **Developer mode**.
2. Choose **Load unpacked** and select the `extension` folder.
3. Open a Google Meet call. A small panel appears bottom-left.
4. Join the call. Meet receives the stand-in camera and mic.
5. Switch on captions in Meet (needed to hear questions).
6. Type a test question in the panel, for example: `Eswar, should we go ahead with this?`

To use Claude as the brain: paste your API key in the panel and press Save. The key is kept in the extension and never enters the Meet page. Then set `brain` to `claude` and paste your context into `contextPack` (see `extension/src/config.js`).

## How it works

1. `media.js` replaces the camera and mic request before Meet makes it.
2. `avatar.js` draws the avatar on a canvas and sends it as the camera.
3. `audio.js` sends speech through a fake mic.
4. `captions.js` reads Meet's captions and waits for the speaker to stop.
5. `brain.js` checks whether the question is for you and is yes/no, asks the brain, then applies the confidence gate (default 75%).
6. Below the limit, or for an open question, the stand-in holds and says it will confirm later.

## Tests

```
npm install
npx playwright install chromium
node test/detect-node.mjs     # question detection, 46 labelled lines
node test/detect-heldout.mjs  # second set of 24 lines
node test/run.mjs             # 24 end-to-end checks in a real browser
```

`run.mjs` loads the real extension, joins a stand-in call page and measures the picture and sound the call receives. No network, no key, no cost.

Results on the last run: detection 46/46 and 24/24, end-to-end 24/24.

**Read these results with care.** I wrote the labelled lines, and I fixed three misses on the second set after seeing them, so that set is no longer unseen. Real accuracy needs lines from real meetings, and decision accuracy needs your own answers.

## Known limits

- Meet can change its page layout, which can break caption reading.
- A background Meet tab can slow the avatar. Keep the call tab visible.
- Your laptop must stay on and awake.
- A synthetic stand-in will look and sound artificial. Tell the people on the call.

## Licence

MIT


## Added (22 Oct 2026)

| Feature | How it works |
|---|---|
| Live brain on a work laptop | `brain-test/relay.ps1` holds the LLM Foundry key. The Meet tab talks to it through a small relay window (press **Connect relay** in the panel). Chrome blocks a direct call. |
| Real voice | The relay turns the line into speech with the Windows voice. If the relay is down, the dummy voice is used. |
| Override | When a yes or no question is held, Yes and No buttons show in the panel for 20 seconds. Nothing leaves the laptop. |
| Recorded clips | Choose `idle`, `nod`, `shake` and `speak` clips in the panel. Missing clips fall back to the drawn head. The AI label stays on top. |

Not built: a phone override. It would send meeting questions to an outside push service, so it needs a data-safe channel agreed first.

The work notes (`brain-pack.txt`) and the test questions are not in this repository. Copy `brain-pack.example.txt` and fill in your own.

Tests: `npm test` runs 35 checks.
