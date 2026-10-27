# AI stand-in for meetings

**Demo page:** https://eshwarpotturi.github.io/meeting-standin/

## Your context: all your notes and projects (27 Oct 2026)

The stand-in answers from a folder, not one file: `brain-test\brain-context\`. Put any `.md` or `.txt` files in it (sub-folders are fine): project notes, READMEs, who is who, standing rules. The relay serves the whole folder. For each question the page picks the most relevant pieces, so the folder can be large and the model only sees what matches the question.

- Files whose name starts with `00` are always included (who you are, standing rules). The list of file names is always included, so the model knows what exists.
- Matching tolerates misheard words ("Viva" finds the Veeva notes) and counts file names.
- Each log line shows which files a question used: `context: question uses 5,200 characters from projects/release-second-opinion.md, ...`
- `brain-test\sync-repos.ps1` refreshes `brain-context\repos` from your public GitHub repos (untested: no PowerShell where it was written).
- The folder is private and is not in Git (`.gitignore`). `brain-pack.txt` still works as a fallback.
- Settings: `contextBudget` (characters per question, 9000), `contextRefreshMs` (how often the relay folder is re-read, 60000).
- Tested: `node test/context.mjs`, 14 checks (right file found, misheard word, size limit, core file, old relay without `/context`). Not tested: the relay's `/context` endpoint in PowerShell, and real questions on real notes.

## Research and get back (chat only) (27 Oct 2026)

Anyone in the meeting can say **"stand-in, research <topic> and get back to me"** (also "Eswar, look into ..." or "do some research on ..."). The stand-in answers in the Meet chat only: no camera change, no voice.

1. At once: "Noted. I will look up ... and post what I find here shortly."
2. It searches Wikipedia and reads the best page (through the relay, same two allowed hosts as the chart).
3. The model writes up to 4 sentences, each with the exact words from the page that support it. A sentence is kept only if those words are really in the page.
4. One labelled chat message: the kept sentences, the Wikipedia link, and "Not checked by Eswar yet." If nothing can be quoted it says so and does not guess. If the relay is not running it says Eswar will follow up himself.

The same topic is not repeated for 5 minutes. Switch off with `research: false` in `standin.config`. Tested in `test/datachart.mjs` (12 checks, mock relay). Not tested: real Wikipedia pages and the real model. It is a Wikipedia lookup, not a general web search, so current news is not covered.

## Data chart: say a phrase, the camera shows public data (27 Oct 2026)

While you explain something, say **"stand-in, chart India GDP growth since 2018"**. The stand-in looks up public data, then shows a chart on your camera in place of the slides, with its source written on the slide. Then it shows a one-line summary. It also posts one labelled line with the source in the Meet chat.

Other ways to say it: "Eswar, show me the data on ..." and "stand-in, plot ..." / "graph ...". Only your own speech starts it. Anyone else saying it is ignored. To chart from the panel or console: type the phrase in the test box, or `standin.chart('India GDP growth since 2018')`. **Clear camera** in the panel puts the idle slide back at once.

### How it finds the data

| Step | What happens | Where |
|---|---|---|
| 1 Plan | The model picks where to look. It chooses a World Bank indicator, or a Wikipedia search. It never supplies numbers | `/llm` on the relay |
| 2 Fetch | The relay downloads the data. Only `api.worldbank.org` and `en.wikipedia.org` are allowed (HTTPS, GET, 4 MB cap) | `/fetch` on the relay |
| 3 Check | World Bank: the plan is validated, empty years dropped. Wikipedia: every number must come with the exact words from the page, and the number must be in those words. One miss rejects the whole chart | In the Meet tab |
| 4 Show | Line chart (years) or bar chart (names), source on the slide, then a summary worked out from the numbers (peak, latest, change since the start). Not written by the model | Camera |
| 5 Chat | One labelled line: title, source, summary | Meet chat |

If the World Bank has nothing usable, it falls back to Wikipedia. If neither gives checked numbers, the camera says "No reliable data found" and nothing is posted. Every log line has a timestamp and step `n/5`.

Settings (`standin.config`): `dataChart` (false = off), `chartHoldMs`, `chartStepMs`, `chartChat`, `chartMinPoints`, `chartRepeatMs` (the same topic is not charted again from speech for 5 minutes).

### Use it

Same as the all-in-one steps below, but update the relay first: the new `brain-test\relay.ps1` has `/llm` and `/fetch`. Restart it, press **Connect relay**, then say or type the phrase. Without the relay the camera says "Data lookup is off".

### Tested: `node test/datachart.mjs`, 51 checks (mock Meet page and mock relay, no network)

Phrase detection (hyphen or not, filler words, last request wins, ordinary talk ignored), plan checks (bad indicator, country code, too many countries, bad years), the Wikipedia grounding check, the full World Bank path (right URL, empty year dropped, source on the slide, summary, chart pixels on the camera, chat line, timestamped steps), other people's speech ignored, repeat topics ignored, fallback to Wikipedia, a bar chart for names, a refused chart for a number not on the page, only the two allowed hosts requested, no relay, and the off switch. `npm test` runs every suite.

### Not tested yet (be clear about this)

- **The new relay endpoints** `/llm` and `/fetch` in `relay.ps1`. There is no PowerShell in the build environment, so they follow the existing `/decide` code but have not been run. The mock relay in the test is JavaScript.
- **Live Meet with a second person**, and real captions of your own speech (speaker "You") triggering the phrase.
- **Real World Bank and Wikipedia replies.** The test data is made up. Check one real topic first, for example "stand-in, chart India GDP growth since 2018".
- **The model's choice of indicator.** If it picks a wrong or retired code, the World Bank returns nothing and it falls back to Wikipedia.

### Limits

- The fallback is a Wikipedia search, not general web search. Many topics have no checkable table there.
- The chart appears with no approval step (your choice). Safeguards: the source is on the slide and in the chat, only checked numbers are drawn, and **Clear camera** removes it.
- The summary describes the numbers. A non-obvious insight comes from choosing a good topic, not from the tool.
- World Bank data lags by a year or more.

## All-in-one: chat + camera slides + open questions + override (23 Oct 2026)

One file, `standin-all.js`, does everything from Anand's feedback in a single paste. It listens to the Meet captions and, when someone asks you a question by name:

| Heard | Chat | Camera (what others see) |
|---|---|---|
| Yes/no, clear from your notes (75%+) | "Yes. / No. + one-line reason" | One big sentence |
| Yes/no, not sure | "Let me check with Eswar." and a **Yes / No** box appears in your panel for 20 s. Click one: "Yes. Eswar has confirmed." No click: "I will confirm after the meeting." | Same text |
| **Open question** ("how is the project going?"), notes cover it (75%+) | A 1 to 2 sentence answer | A slideshow of 1 to 3 slides, plus a pie or bar chart when your notes have real numbers |
| Open question, notes do not cover it | "I will confirm after the meeting." | Same text |

Always: every chat message starts with `[AI stand-in for Eswar]`, the first says it is an AI, and the camera shows "AI stand-in for Eswar" on every slide. No face, no voice. Your real microphone is untouched.

### Use it

1. Start the relay: `brain-test\relay.ps1` (updated: it now has an `/answer` endpoint for open questions). Put your notes in `brain-test\brain-pack.txt`, including any numbers you want charted.
2. Join the Meet call, switch captions on, open the chat panel once.
3. Console (F12) on the Meet tab: paste the whole of `standin-all.js`.
4. **Turn your Meet camera off and on once.** Meet only asks for the camera again then, and that is when it picks up the slide camera. Also open **Backgrounds and effects** and make sure **blur is off**: Meet sees no person in the slide picture and blurs the whole slide (found in the live Meet test).
5. In the panel (bottom-left): **Connect relay** (allow pop-ups, leave that window open), then test with the **Test question** box, for example `Eswar, how is the project going?`.
6. Pause, the confidence slider (50 to 95), and the Yes / No override are in the same panel.

Settings (`standin.config`, saved with `standin.save()`): `camera` (false = leave your camera alone), `openAnswers`, `slideStepMs`, `slideHoldMs`, `overrideWaitMs`, `threshold`. Rebuild after editing: `npm run build:all`.

### Tested (mock Meet, no network): `node test/all.mjs`, 48 checks

Camera pixels (idle slide, answer slide, slideshow advancing, pie chart colours, return to idle), real mic kept, chat for yes/no and open, held and low-confidence cases, override Yes / No / timeout, panel (typed question, pause, resume, threshold saved), refusal of malformed model output, and the relay path through a mock of `relay.ps1`. Also fixed: text said while paused is no longer answered on resume.

### Captions: built on Anand's meetcaptions tool

The caption reader now uses the same page structure as his bookmarklet (`tools.s-anand.net/meetcaptions`: the Captions region, one item per speaker turn, speaker name and text), so it knows **who is speaking**:

- It answers a question once the speaker has finished the turn (about 1.2 s after the text stops changing), even if the sentence grew while being said.
- It ignores your own speech (speaker "You"; `ignoreOwnSpeech`).
- It keeps a running transcript in his file format (speaker headings with `[m:ss]`, same speaker merged). **Save captions (.md)** in the panel, or `standin.saveTranscript()`, downloads it. The last six turns go to the brain as "recent meeting lines".
- If Meet changes its layout it falls back to reading the whole caption box as one block.
- You can still run his bookmarklet alongside it if you want his recording file; the two do not interfere.

His **Meet MP4 Background** bookmarklet works by letting Meet's background picker accept `.mp4`. That is a possible fallback for the camera (pre-made videos, no camera off/on), but the live slide camera here does not need it.

### Tested on live Google Meet (23 Oct 2026, 15:18 to 15:28 IST, Chrome, alone in a call)

| Part | Result |
|---|---|
| Load the script in Meet (Trusted Types rule) | Works |
| Chat button "Chat with everyone" and box "Send a message" | Found; messages posted and labelled |
| Slide camera, one sentence | Works (self-view is mirrored; others see it the right way round) |
| Slideshow, 3 frames, back to idle | Works |
| Camera taken on the join screen | Works. **Best way:** load the script on the join screen, switch the camera off and on, then press Join now. |
| Caption region `[role=region][aria-label=Captions]` | Found; turns read with speaker "You" |
| Caption turn, no question mark, then answered in chat and on camera | Works after two fixes below |
| Meet blur | **Blurs the whole slide.** Fixed by choosing no effect in Backgrounds and effects. |
| Relay (`relay.ps1`), voice, real Meet speech from other people | Not testable here (no PowerShell, no second person) |

Bugs found live and fixed: (1) the caption settings button text ("settings") was read as a caption; (2) "Eswar, did the report go out today" without a question mark was not treated as a question; Meet often leaves it off while a turn is still growing. Captions are scored after 1.2 s of silence either way.

Live tests used typed text placed in the real caption box, because the stand-in cannot make Meet transcribe speech from a quiet room.

### Still untested on live Meet

The Meet chat selectors ("Chat with everyone", "Send a message"), the caption region, and whether Meet really takes the camera after the off/on. `relay.ps1` `/answer` was not run here (no PowerShell in the build environment); it follows the `/decide` code. If one of these fails, `standin.chatCheck()` and the console log (every line timestamped) say which.

Not done: reading Anand's caption `.md` file as input; "research and get back to me" beyond what is in your notes.

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
