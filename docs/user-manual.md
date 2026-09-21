# Interactive Bible App — User Manual

This manual shows how to use the Interactive Bible App to read Scripture with verse-by-verse insights, build a library of sermons and studies linked to the verses they discuss, explore the Bible world, and prepare sermons. It is written for pastors, Bible teachers and church volunteers — no technical knowledge needed.

Words in **bold** are labels you see on screen. Installing the app is covered in the project README; this manual assumes it is already set up.

## Contents

1. [Welcome](#1-welcome)
2. [Getting started](#2-getting-started)
3. [Finding your way around](#3-finding-your-way-around)
4. [Reading the Bible](#4-reading-the-bible)
5. [Search and Ask AI](#5-search-and-ask-ai)
6. [Your library](#6-your-library)
7. [Adding to your library](#7-adding-to-your-library)
8. [Reviewing verse links](#8-reviewing-verse-links)
9. [Explore](#9-explore)
10. [Sermon Studio](#10-sermon-studio)
11. [Admin tools](#11-admin-tools)
12. [AI, privacy and costs](#12-ai-privacy-and-costs)
13. [Troubleshooting and FAQ](#13-troubleshooting-and-faq)

---

## 1. Welcome

The Interactive Bible App is a Bible study and preaching companion that runs on your own computer. You use it in a web browser, but your Bible texts, library, sermons and settings stay on that computer.

| Area | What it helps you do |
|---|---|
| **Read & Library** | Read the World English Bible (WEB), King James Version (KJV) or American Standard Version (ASV). Tap a verse to see the sermons, podcasts and studies in your library that discuss it — at the exact moment or page — plus related passages, themes and people. Search by meaning and ask questions. |
| **Explore** | Walk through 50 key events on a map, browse a 583-event timeline, trace the family line to Jesus and watch narrated story videos. |
| **Sermon Studio** | Turn notes, your voice, recordings, documents and Scripture into a finished sermon with slides, speaker notes, social posts and a share page. |

The areas are linked: a verse can start a sermon or open its event on the map, and every event opens its passage in the reader.

- **Stays on your computer:** Bible texts, maps, your library and transcripts, verse links, sermons, stories, accounts and settings.
- **Goes to Google Gemini**, only when you use an AI feature: the text or recording that feature needs ([details](#12-ai-privacy-and-costs)).
- **YouTube:** the app reads a video's details and captions from YouTube and plays it in YouTube's own player. Videos are never downloaded.

---

## 2. Getting started

### Open the app

1. Make sure the app is running (see the box below).
2. On that computer, open a web browser and go to **http://localhost:8000**.
3. There is no sign-in on this computer: you are the **Owner**, with full access, including the admin tools.

> **Starting and stopping** (for whoever looks after the computer) — in a terminal, inside the app's folder:
> - `make start` — start the app in the background
> - `make stop` — stop it
> - `make status` — check whether it is running

### Your profile

Your name and church appear on the sermons you publish.

1. Select your name at the bottom of the sidebar (on a phone, your initials at the top right) and choose **Profile**.
2. Fill in **Name** and **Church or ministry (optional)**, then select **Save profile**.

Until you do, the app uses the placeholder owner name created during setup.

### Light or dark

The app starts with your device's light or dark setting. Switch with the sun/moon button at the bottom of the sidebar, or choose **Dark theme** / **Light theme** in the menu under your name. Your choice is remembered on that device.

![The reader and Verse insights in the dark theme](images/read-dark.png)

### On a phone, tablet or another computer

Any device on the same network (for example the church Wi-Fi) can use the app.

1. Find the computer's network address in its network settings (it looks like `192.168.1.20`).
2. On the other device, go to that address followed by `:8000` — for example `http://192.168.1.20:8000`.
3. Select **Sign in** (bottom of the sidebar, or the icon at the top right on a phone) and sign in — or choose **Create an account** on the sign-in page.

**Why sign in there?** Personal mode trusts only the computer the app runs on, so nobody else on the Wi-Fi gets owner access, changes your library or spends your AI credits. Without signing in, visitors can still read, search, browse public library items and Explore, and open published sermons; asking AI and creating anything with AI need an account.

Setup creates sample accounts for other devices: `admin@interactivebible.local` (the owner's own account — use it for owner access on your phone), `editor@interactivebible.local` (reviewing, adding, sermons), `member@interactivebible.local` (sermons and adding) and `outsider@interactivebible.local` (a member with no church, for checking privacy). They share one password, which setup makes up at random and saves as `DEMO_PASSWORD` in the app's `.env` file — ask whoever looks after the computer.

> **Keep that password private.** Anyone on your network who has it can sign in, and the admin account has full access. `make new-demo-password` replaces it with a new random one (saved in `.env`, in effect at once); to choose your own, set `DEMO_PASSWORD` in `.env` and run `make demo-password`. A password changed under **Profile** is reset to `DEMO_PASSWORD` by `make seed` and `make setup`. In `.env`, `ALLOW_SIGNUP=false` stops visitors creating accounts, `SINGLE_USER_TRUST_NETWORK=true` gives every device owner access (only on a network you fully trust), `SINGLE_USER_MODE=false` makes everyone sign in, even on the computer itself, and `API_HOST=127.0.0.1` keeps other devices out altogether. Restart the app after changing `.env`.

**Sharing links.** Links you copy on the computer itself — a verse, a chapter or a sermon's share page — use the computer's network address (like `http://192.168.1.20:8000/…`) rather than `localhost`, so they open on other devices on the same network while the app runs with `make start`. To share beyond your network, for example through a web address you have set up for the app, set it as `PUBLIC_BASE_URL` in `.env`.

---

## 3. Finding your way around

| Sidebar group | Pages |
|---|---|
| **Read & study** | **Home**, **Read**, **Search & Ask**, **Library**, **Scripture Map** |
| **Create & explore** | **Explore**, **Sermon Studio** |
| **Workspace** | **Add to library** and **Admin** (signed-in users; **Admin** for the owner and editors) |

- **Collapse sidebar** shrinks the sidebar to icons. The top bar holds the search box and, on wide screens, **Ask AI**.
- On a phone, the bottom tab bar has **Home**, **Read**, **Explore**, **Sermons** and **More** (full menu, profile and theme).

### The search palette

Press **⌘K** (Mac), **Ctrl+K** (Windows) or **/**, or click the search box. Type a reference (`John 3:16` → **Open John 3:16** or **Verse insights for John 3:16**), a book or page name, or any words (**Search for "…"** or **Ask AI: "…"**). It also lists **Recent** items, your sermons, matching library items and **Start a new sermon**.

### Home

Type a passage or topic in **What would you like to study today?** and select **Go** — references open the reader, anything else searches. Below are the **Verse of the day**, **Continue reading**, **Your sermons**, **Today's story · Explore**, a card for each area, and **From your library**.

### Keyboard shortcuts

| Where | Keys | Action |
|---|---|---|
| Anywhere | ⌘K / Ctrl+K, or / | Open the search palette |
| Reader | Alt+← / Alt+→ (Option on a Mac) | Previous / next chapter |
| Reader | Shift+click · Esc | Select a range · clear the selection |
| Ask AI box | ⌘/Ctrl+Enter | Send the question |
| Reviewing a link | A · R · E · J or → · K or ← | Approve · reject · edit · next · previous |
| Sermon editor | ⌘/Ctrl+S · ⌘/Ctrl+B · ⌘/Ctrl+I | Save · bold · italic |
| Story video | ← → · Space | Change scene · play or pause |

---

## 4. Reading the Bible

### Open a passage

- **Read** opens where you left off (the first time, Romans 8:28).
- The book-and-chapter button (for example **Romans 8**) lets you **Find a book…** and pick a chapter; on a phone, choose the book, then the chapter. The arrows beside it, and the **Previous chapter** / **Next chapter** cards at the end of each chapter, step through the Bible.
- Or type the reference in the search palette.

### Translation, text size and markers

- Choose **WEB**, **ASV** or **KJV** in the toolbar.
- The **T** button opens **Reading settings**: **Text size**, **Show insight markers** and, on phones, **Translation** — all saved on that device.
- **Insights** turns the gold markers on or off. A **filled dot** means your library names or quotes the verse; a **ring** means it is only discussed by context or suggested as related.

### Select verses

Click or tap a verse to select it (again to clear). Shift-click — or press and hold on a touch screen — to select a range; Esc clears. On a computer, **Verse insights** opens beside the text; on phones and tablets a bar offers **Insights**, copy, share and clear.

### Verse insights

![Romans 8 in the reader, with verse 28 selected and Verse insights open](images/read-verse-insights.png)

| Tab | What you find |
|---|---|
| **Overview** | Counts for **Watch**, **Listen**, **Read** and **Related**; **Bring it to life**; top items **From your library**; related Scripture; themes; **About the book** |
| **Resources** | Library items that discuss the passage — **Watch**, **Listen** or **Read** — filtered by **Direct & quotes**, **Contextual**, **AI related** or **Human verified** |
| **Related** | Cross-references with a match score; **Why related?** explains each link |
| **Themes**, **People** | Big ideas, people, events and places, linking to search and the Scripture Map |
| **Map** | A close-up of the Scripture Map |
| **Ask AI** | Questions about the passage |

Library cards show how the verse is used (**Direct Mention**, **Scripture Quote**, **Contextual Reference** or **AI Related**), **Human verified** when an editor has checked it, and **Why it's here**. Select **Play this moment**, **Listen** or **Open section**. The **…** button reports a wrong connection (see [Feedback from readers](#feedback-from-readers)). Confidence measures how well a source supports a link — it is not theological truth.

### Ask AI about a passage

1. Open the **Ask AI** tab.
2. Pick a suggested question or type one in **Your question**, then select **Ask AI**.

In 5–15 seconds you get an answer built only from the passage, the verses around it, related Scripture and your library. It is labelled **Well supported**, **Partly supported** or **Tentative**, with **Sources** you can check. Answers are saved, so repeating a question is instant. On other devices, sign in first (**Sign in to ask AI**) — each answer uses the app's Gemini key.

### Bring it to life

On the **Overview** tab, **Start a sermon on …** opens Sermon Studio with the passage filled in, matching Explore events appear **On the atlas** and **On the timeline**, and **See its connections** opens the Scripture Map.

### The Scripture Map

The **Scripture Map** draws how a passage connects to other verses, themes, people, events, places and your library. Enter a reference in **Start from a verse** and select **Map it**, or pick a theme. Switch **View** between **Map** and **List**, and filter by kind, by **Links** (**All**, **Named & quoted**, **Named only**), **Verified by an editor** and **Reach**. Tap a circle for actions such as **Read**, **Center here** or **Play clip**. Dashed purple lines are AI suggestions — treat them as leads.

---

## 5. Search and Ask AI

1. Open **Search & Ask**, describe what you want in everyday words (`hope in suffering`) or type a reference, and select **Search**.
2. Choose **Bible & library**, **Bible** or **Library**. For the library, narrow to **Videos**, **Audio**, **Sermons**, **Studies**, **Devotionals** or **Articles**.
3. **Understood:** shows what the app recognised. Verse results show a match score, **Insights** and **Read**; library items appear under **From your library**.

**Searched by meaning** needs Gemini and the Bible search index; otherwise you'll see **Keyword and reference search**.

**Asking a question.** Under the results, **Want a direct answer?** → **Ask AI** answers from the passage chosen in **Based on**, with sources, in about ten seconds. **Ask AI** in the top bar opens **Ask a question about the Bible**: type your question and select **Search**, and the answer follows automatically. Answers are AI-generated, not an authoritative interpretation.

---

## 6. Your library

The **Library** lists every sermon, podcast, study and article you can see. Search titles, speakers and authors; filter by **Video**, **Audio**, **PDF**, **Document**, **Article**, **Notes** or **Added by me**. Cards show the type, **YouTube**, **Official** and **Private** badges and the number of linked verses — or a status such as **Processing…** or **Processing failed**.

### A resource page

![A sermon's page in the library, with its player, verse clips and sections](images/library-resource.png)

- **Top:** title, speaker and length, with buttons such as **Watch on YouTube**, **See connections**, **Reprocess** and (for editors) **Manage**.
- **Left:** the player, **Chapters** (from YouTube), and **Verse clips** — each verse with how it is used, its time, **Play this moment** and **Open clip**. Documents show **Scripture in this …** and **Open original** instead.
- **Right:** **Sections**, each with a summary, verse links, **Play from here** and **Show transcript**. Highlighted words are where Scripture is mentioned; select a sentence to play from there. **Only sections with Scripture** hides the rest.
- While an item is processing, a banner shows its progress; you can leave the page.

### Verse clips

A verse clip is the moment — usually 15 seconds to 3 minutes, on whole sentences — where a verse is discussed. From a verse page or search results, **Play this moment** opens the clip over the page (close it with × or Esc); on a resource page it plays in that page's player, and **Open clip** gives the clip its own page.

- **YouTube videos** play in YouTube's player from the start of the clip and stop at its end. Use **Play from the start of the clip**, **Watch the whole video** or **Watch on YouTube**. Choosing a chapter or transcript line reloads the player there — press play if needed.
- **Your own recordings** show the clip on a bar (the gold band is the key moment), with **Play clip** and **Keep playing the full video**.
- **Linked Scripture**, **Why this clip**, the **Transcript** and **Previous** / **Next** sit alongside.
- **Save clip as a file** appears only for recordings you own or license with downloads allowed — never for YouTube.

### Service recordings

For a whole church service, a **Message** button at the top shows when the sermon starts and ends (select it to play), with a line like "Rest of the recording: Worship (12) · Welcome (2) — not mapped to verses". Other sections are labelled **Worship**, **Welcome**, **Announcements**, **Prayer**, **Scripture reading**, **Communion**, **Testimony** or **Other**. Only the message is linked to verses and clipped.

---

## 7. Adding to your library

Open **Add to library** from the sidebar, the Library page or your account menu. There are four steps — **Source**, **Details**, **Sharing**, **Review** — and nothing is added until you press the final button. Typed details are kept on this device if you leave (**We kept your unfinished draft**); files must be chosen again.

| Source | Use it for |
|---|---|
| **YouTube link** | A sermon or service on YouTube — nothing is downloaded |
| **Upload a file** | Video (MP4, MOV, M4V, WebM) or audio (MP3, WAV, M4A, AAC, OGG, FLAC) up to 1 GB; PDF, Word (.docx), .txt or .md up to 50 MB. With a recording, add a .vtt or .srt captions file to skip AI transcription |
| **Paste text** | Notes, a devotional, a study or an article (**My own writing**, **An article** or **AI-generated**) |
| **Other web link** | A direct link to an .mp4 or .mp3 file, or an article on the web |
| **Captions file** | Subtitles (.vtt or .srt), with the recording optional — no AI transcription |

### Add a YouTube link, step by step

1. Choose **YouTube link** and paste the address (youtube.com, youtu.be and Shorts links all work). The app checks it automatically, or select **Check link**.
2. Look over **Found on YouTube**: picture, title, channel, length, date, chapters and language. A coloured band says where the words will come from (human-made captions are used when the video has them):
   - **Captions from YouTube · human-made** — accurate, no AI transcription;
   - **Captions from YouTube · auto-generated** — usually good, though names and quotes can be a little off;
   - **No captions — Gemini will transcribe this** — slower (often 5–15 minutes for a long service) and it costs AI credits.
3. **Continue** to **Details**, which are **Filled in from YouTube**. Adjust the title or speaker, and optionally list verses and topics you know it covers under **Help it find Scripture** (hints only — every link is still checked).
4. **Continue** to **Sharing** and choose **Who can find it?** — **Public**, **Church members**, **Unlisted** (direct link only) or **Private**. The video stays on YouTube, so it is recorded as **Embedded playback only** and clip files can't be downloaded. The owner and editors can turn on **Official church content** or **Approve every verse link myself** so that nothing is shown until they approve it.
5. **Continue** to **Review**, check the summary, keep **Start processing as soon as it's added** on, and select **Add to library and start processing**. (If you switch it off, the item waits until you select **Start processing now**.)
6. Follow the progress, or leave — it carries on in the background. When it says **Ready**, open the item to see its verse clips.

**Songs and the rest of a service.** Captions mark music ("[Music]", "[singing]", "♪"), so songs are recognised and never searched for verses. For longer recordings (about ten minutes or more), the **Find the message** step then works out where the sermon begins and ends and labels everything else — worship, welcome, announcements, prayer, Scripture reading, communion, testimony or other. A prayer or reading inside the sermon stays part of it. Only the message is linked and clipped, which also lowers the AI cost. Without Gemini, only the songs are set aside.

**Timing.** With captions, usually 1–5 minutes (3–8 for recordings over about 45 minutes); without captions, roughly 5–15 minutes for a long service.

**Refused links.** The message says why: the video is private, members-only, age-restricted, unavailable, or still live (add it once the recording is published). "YouTube refused the request" usually passes within a few minutes.

### What the processing steps mean

You can follow every step in **Admin → Processing monitor**.

| Phase | Steps |
|---|---|
| 1. Read it | **Check the item**, **Keep the original safe**, **Read or transcribe**, **Tidy the text** |
| 2. Find Scripture | **Split into sections**, **Find the message**, **Find Bible references**, **Find quotations**, **Look for related verses**, **Check verse links with AI** |
| 3. Enrich | **Tag topics and people**, **Write section summaries**, **Choose clips**, **Double-check quality** |
| 4. Publish | **Decide what needs review**, **Save verse links**, **Update search**, **Publish** |

### If something goes wrong

- **Processing stopped with an error:** read the message and select **Try again** — links you have reviewed are kept. The monitor's **Needs attention** tab lists these items.
- **Stuck on "Waiting for a background worker…":** see [Troubleshooting](#13-troubleshooting-and-faq).
- **"Processed without AI":** Gemini was unavailable; process it again later to find more links.
- **Changes later:** open the item in the Processing monitor and use **More** — **Edit details**, **Process again**, **Transcribe again** (a fresh transcript; costs more), **Reset verse links…** (discards your review decisions) or **Delete…**.

---

## 8. Reviewing verse links

The app links verses automatically, but you stay in charge: links it is unsure about wait in the **Review queue** for the owner or an editor.

| Confidence | What happens |
|---|---|
| 90% or more | Shown to readers |
| 80–89% | Shown but flagged; until checked, readers see it as **AI Related** with a "not yet verified" note |
| 65–79% | **Search only** (not on verse pages) and sent for review |
| Below 65% | **Discarded** |

AI suggestions need 90% to be shown. For items marked **Official church content** or **Approve every verse link myself**, every link waits for approval. So each link has a status: **Shown to readers**, **Approved**, **Search only**, **Waiting for review** (hidden until approved), **Rejected** or **Discarded**.

| In review screens | Readers see | Meaning |
|---|---|---|
| **Direct mention** | **Direct Mention** | The verse is named ("Turn with me to Romans 8:28…") |
| **Scripture quote** | **Scripture Quote** | Its words are quoted or closely paraphrased |
| **Story or passage** | **Contextual Reference** | A story or passage is discussed without quoting it |
| **AI related** | **AI Related** | AI thinks it is about the same idea — a lead, not a fact |

![The Review queue with its glossary and status tabs](images/admin-review.png)

1. Open **Admin → Review queue**. **Needs review** lists pending decisions; other tabs include **Reported by readers**, **Search only**, **Shown to readers**, **Approved** and **Rejected**. Filter by verse, usage, confidence or content.
2. Open a card. **What was said** highlights the evidence; select a sentence to play from there.
3. Decide **Is … a good match for this section?** using the verse text, **Why it was linked**, the **AI double-check** and **Why it's in the queue**. Add a **Note for the history** if useful.
4. Choose **Approve** (shown to readers, marked as checked by a person), **Reject** (hidden, even after reprocessing), **Edit** (fix the verse, usage, confidence or evidence, then **Save and approve**) or **Make main verse**. The next item opens automatically.

The same page lets you adjust the **Clip boundaries** a sentence at a time, merge verses into one passage, **Add a verse the system missed** and edit the **Section tags**.

### Feedback from readers

Anyone can use the **…** button on a library card or clip — **Is this Scripture connection right?** — to choose **Helpful connection**, **Not relevant**, **Wrong verse**, **Wrong timestamp**, **Wrong quote or reference** or **Report a problem…**. Reports arrive in **Admin → Feedback**, where you mark them **Looking into it**, **Resolved** or **Dismiss**, or **Review the link**. If three different people report a link nobody has checked, it is hidden and returns to review.

---

## 9. Explore

Open **Explore** and switch between **Atlas** and **Timeline**. The **?** button explains **How Explore works**.

### The atlas

![The Explore atlas with Crossing the Red Sea open on the Info tab](images/explore-atlas.png)

- **Bible events** lists the 50 key events; search them or show only **Journeys**, **Events** or **People**.
- The **Era** bar (**Primeval** to **Jesus**) focuses on one period.
- Select a pin or list row. A pin's pop-up offers the passage, **Show this era** and **Open in Timeline**.
- **Map layers** switches the base map (**Relief**, **Parchment**, **Night**) and shows kingdoms, rivers, journey routes and place names. The map works offline.

| Tab | What it shows |
|---|---|
| **Info** | A summary; **Read …**, **Start a sermon**, **See it on the timeline**; the story, key lesson, the place then and today, the journey and the people |
| **Family** | The family line to Jesus and **Open the family tree** |
| **People** | **Who was there** — the event from each person's point of view |
| **Video** | A narrated story video |
| **Graph** | **How the Bible connects** — people, events, places, concepts and books |

**Family tree:** switch between the **Storybook tree** (the line toward Jesus) and the **Full map** of every person; select a person for **Show ancestors**, **Show children** or **Show path to Jesus**.

**Teaching notes and illustrations:** on **Info**, **Enhance with AI** adds a teaching summary, notes on the place, discussion questions and a **Quick quiz** (about 20 seconds), and **Illustrate with AI** paints the event (about 15 seconds). Both are saved for everyone; check teaching notes against Scripture.

### Story videos

![A four-scene story video in the Video tab, in the dark theme](images/explore-story.png)

1. On the **Video** tab, select **Create story video**.
2. Choose **Widescreen** (16:9 — TV, projector, YouTube) or **Vertical** (9:16 — phones, Reels, Shorts, WhatsApp status).
3. Watch **Script**, **Scenes**, **Narration** and **Saving** complete — about a minute. You can keep exploring meanwhile.
4. Press play for four painted scenes with narration, or go **Full screen**.

Under **Save or share this story**, **Captioned video** → **Make video** records a captioned version in your browser (Chrome or Edge; keep the tab open), then **Download**. **HD MP4 with narration** → **Download MP4** renders a full-HD file on the computer — ideal for projecting in church. Stories are shared with everyone; **New version** replaces one.

### The timeline

![The timeline with an event selected and Explain with AI](images/explore-timeline.png)

- 583 events from Creation to Revelation, grouped by era. Search, show only **Major events**, **Life of Jesus** or **On the map**, and choose **Whole Bible**, **Old** or **New**.
- Select an event for **Read passage**, **Start a sermon**, **Open on map** and **Family tree** (the last two only for the 50 atlas events).
- **Explain with AI:** choose **Simple**, **Study**, **Pastor** or **Kids** and select the button below — you get a summary, why it matters, background, a lesson and discussion questions, saved for everyone.
- **Story mode** writes a short walk-through (up to six scenes) of the events you are viewing — good for opening a class.
- The download button saves the listed events as a data file.

Every reference opens the reader, and **Start a sermon** opens Sermon Studio with the passage and event title filled in. On other devices, creating anything with AI in Explore needs a signed-in account.

---

## 10. Sermon Studio

![The Present & publish step of a published sermon](images/sermon-studio.png)

Sermon Studio takes a sermon through four steps: **Collect → Polish → Visuals → Publish**. Work saves as you go, and you can return to any step. Sermons are private — nobody else, not even an admin, can open yours; others can read one only after you publish it.

### Dashboard and new sermons

- **Your sermons** shows each sermon's progress and next step; filter by **All**, **In progress** or **Published**, or search. The **⋮** menu on a card offers **Continue working** and **Delete…** (permanent) and, once the sermon is published, **Copy share link** and **View share page**.
- **New sermon:** type a working **Title** and an optional **Key Scripture** (the verse text previews), then select **Create sermon**. The passage becomes your first collected item.
- You can also start from a verse (**Start a sermon on …**), an Explore event (**Start a sermon**) or the search palette (**Start a new sermon**).

Select the title at the top to rename a sermon; beside it you'll see **Saving…** or **All changes saved**. A locked step tells you what it needs first.

### Step 1 — Collect

**Sermon details** (**Title**, **Key Scripture** and an optional **Big idea**) guide the AI. Then **Add content** in any mix:

| Option | How it works |
|---|---|
| **Type notes** | Type or paste rough notes, then **Add notes** |
| **Speak** | **Start speaking** and your words appear as you talk (Chrome, Edge or Safari), then **Add spoken notes** |
| **Recording** | Upload audio up to 1 GB; AI transcribes it |
| **Document** | A PDF, Word, text, Markdown or HTML file up to 50 MB, read on your computer |
| **Scripture** | A passage and translation, with optional **Study notes**, then **Add Scripture** — the exact verse text is looked up |

Everything appears in **Your collected content**, and unsaved typing is kept on this device. Then select **Continue to Polish**.

### Step 2 — Polish

1. **Choose your sermon style**: a **Format** (**Sunday Message**, **Prayer Focus**, **Story-Driven**, **Devotional**, **Bible Teaching**, **Testimony**, **Youth Message**, **Small Group Guide**, **Storytelling** or **Custom Polish**), a **Tone** (**Inspirational**, **Teaching**, **Evangelistic**, **Devotional**, **Youth** or **Prophetic**) and a **Language** (English, Spanish, French, Portuguese, German, Swahili, Hindi, Tamil, Telugu or Malayalam).
2. Select **Write my draft**. It takes about a minute, and Scripture is quoted from the app's exact verse text.
3. Edit in **Your draft**. It saves automatically and shows roughly how long the sermon takes to preach.

Later, **Change style** offers **Reshape draft** (keeps your edits and reorganises them) or **Write fresh draft** (starts again from your content). **Get suggestions** offers hooks, illustrations, applications, cross-references and closings to copy, without changing your draft. Then select **Continue to Visuals** or **Skip to Publish**.

### Step 3 — Visuals (optional)

Choose **Standard** or **High quality**. **Create visual set** paints six scenes — the title, the key Scripture and each main point — in 1–2 minutes. Or make a single **Illustration**, **Bible map**, **Timeline**, **Scripture slide** or **Title graphic** from your own description, or with **Let AI choose from my sermon**. **+ Add a caption** labels a picture; visuals are used in your slides, video and share page.

### Step 4 — Present and publish

- **Look & slides:** pick a **Theme** (**Navy & Gold**, **Royal Purple**, **Minimal Slate**, **Light Classic** or **Warm Sand**), set **Slides for PowerPoint** (8–20) and select **Design my slides**. In 1–2 minutes AI gives each slide a layout and a picture.
- **Download & present:** **Download PDF** (for Hindi, Tamil, Telugu and Malayalam it opens a print view — choose "Save as PDF"), **Download slides** (PowerPoint with speaker notes), **Open print view**, and **Sermon video**: **Start recording** your voice, then **Make video** (your visuals play behind it in real time) and **Download video**.
- **Speaker notes:** **Write speaker notes** adds delivery tips, timing, transitions and altar-call guidance, which you can edit.
- **Summary & social posts:** **Write summary & posts** gives a church summary, a caption, hashtags, and Instagram, Facebook and X posts to copy.

### Publish and share

1. In the **Share page** box, select **Create summary & posts** if you haven't yet.
2. Switch it to **Published**, then use **Copy link** or **View page**. The link uses the computer's network address, like `http://192.168.1.20:8000/share/…`, and a note under it says who can open it.

The share page shows the title, Scripture, your name and church, the summary, your visuals and the full sermon. Readers need no account, but they must be able to reach the computer — on the same network, or through the address set as `PUBLIC_BASE_URL` (see [On a phone, tablet or another computer](#on-a-phone-tablet-or-another-computer)). To unpublish, switch it off and confirm **Unpublish**; the link stops working until you publish again, and it stays the same.

---

## 11. Admin tools

The owner and editors see **Admin** in the sidebar.

| Section | Use it to |
|---|---|
| **Dashboard** | See warnings (Gemini not set up, worker stopped, failed items, AI allowance), links waiting for review, **AI spend today** and system **Health** |
| **Processing monitor** | Follow every item live (**Processing**, **Needs attention**, **Ready**, **Not processed**); open one for its steps, AI cost and **More** actions |
| **Review queue**, **Feedback** | Decide on verse links and reader reports ([section 8](#8-reviewing-verse-links)) |
| **Audit history** | See every review and admin change — who, what and when |
| **Metrics** | Processing, AI use and cost, reviews, reports and searches over 24 hours to 90 days |
| **Topics & entities** | Manage the themes, people, places and events used for tagging and search. **Link mentions to these passages** links a name such as "the prodigal son" to Luke 15 |
| **System & AI** | Check Gemini (**Run test**), the Bible search index (**Build or resume the index**, usually well under a dollar), workers, database and storage |

---

## 12. AI, privacy and costs

### What uses AI

The app uses Google Gemini for AI. Without a key it keeps working in a safe, reduced mode — nothing is shown or published because AI failed.

| Area | Gemini is used for | Without Gemini |
|---|---|---|
| Reading | **Why related?** explanations and filling in a verse's themes | Everything else works |
| Library | Transcription without captions, finding the message, checking and suggesting verse links, topics, summaries, clips | Captions, documents and text are read; written references, exact quotations and named passages are still found |
| Search | Meaning search and Ask AI | Keyword and reference search |
| Explore | Teaching notes, illustrations, stories, explanations | The atlas, timeline, family tree, graph and anything already created |
| Sermon Studio | Transcription, drafts, suggestions, visuals, slides, notes, posts | Notes, dictation, documents, Scripture, editing, exports and existing share pages |

To turn AI on, add `GEMINI_API_KEY=` followed by a key from Google AI Studio (https://aistudio.google.com/apikey) to the `.env` file, run `make stop` and `make start`, then select **Admin → System & AI → Run test**.

### What is sent, and where your data lives

- Gemini receives only what a task needs: section text, your question with its passages, your sermon notes and draft, event details, picture descriptions and narration text, and verse text for the search index. Recordings are sent only when there are no captions; for a YouTube video without captions, Gemini gets its public link.
- The Gemini key stays in the `.env` file and is never shown in the app.
- YouTube supplies video details and captions, and clips play in YouTube's privacy-enhanced player. Live dictation uses your browser's speech recognition, which some browsers process online.
- Everything else stays on the computer: a local database (library, verse links, sermons, stories, accounts, history) and the `storage` folder (files, pictures, videos). Reading settings, recent items, unfinished forms and captioned story videos live only in your browser, and a recorded sermon video isn't kept at all — download it.

> **Backups** — `make backup` saves the database and the `storage` folder to `.data/backups/<date-time>`; `make restore BACKUP=.data/backups/<date-time>` restores both (then run `make start`). Keep a copy on another drive.

### Costs

You pay Google for Gemini with your own key. Measured examples at the app's standard settings:

| Task | Approximate cost |
|---|---|
| 10-minute sermon with captions | $0.08 |
| 65-minute service with captions | $0.33 |
| 103-minute service without captions | $0.61 |
| One AI picture | $0.04 |

Google sets the prices, so check your own figures: **AI used (last run)** in the Processing monitor, **AI spend today** on the Dashboard and **AI cost by feature** in Metrics.

**Repeats are free.** Identical requests reuse saved results: processing again reuses the transcript and earlier analysis, repeated Ask AI questions are instant, and Explore content is made once for everyone. Sermon Studio writing and new pictures are always made fresh.

**Limits.** Each person can make up to 120 AI creation requests an hour in Sermon Studio and Explore ("You have reached the hourly limit for AI generation. Please try again later."). The whole app has a daily allowance of 5 million AI tokens — the Dashboard warns at 80%, and when it runs out AI pauses until the next day. Ask AI needs an account on other devices and allows 12 questions a minute per person. All three can be changed in `.env` (`AI_CREATIVE_CALLS_PER_HOUR`, `GEMINI_DAILY_TOKEN_BUDGET`, `ASK_RATE_LIMIT_PER_MINUTE`).

---

## 13. Troubleshooting and FAQ

| Problem | What to do |
|---|---|
| The page won't load, or says "Can't reach the app right now" | Run `make status`, then `make start`. |
| Port 8000 is already in use | Run `make stop` and start again; if another program uses the port, set a different `API_PORT` in `.env`. |
| Another device can't connect | Use the computer's network address with `:8000`, stay on the same network, start with `make start` (with `API_HOST=0.0.0.0`, the default), and check the computer's firewall. |
| An item stays on "Waiting for a background worker…" | The worker isn't running: `make status`, then `make start` (its log is `.data/logs/worker.log`). |
| "Processing stopped with an error" | Processing monitor → **Needs attention** → open the item → **Try again**. |
| A YouTube link is refused | Use a public or unlisted video, and wait for live streams to end. If "YouTube refused the request" persists, update the YouTube reader with `backend/.venv/bin/pip install -U yt-dlp` and restart. |
| A YouTube video has no captions | Let Gemini transcribe it. Or, with your own .vtt or .srt file, choose **Other web link → A video or audio**, paste the YouTube link, add the captions file, and choose **Embedded playback only** on **Sharing**. |
| "AI is not available right now" or "Ask AI isn't set up yet" | Add the Gemini key, restart and select **Run test**. If the test fails, the key may be wrong — create a new one. |
| "You have reached the hourly limit for AI generation" | Wait a while, or raise the limit. |
| Search shows only **Keyword and reference search** | Add the key; the Bible search index then builds in the background (see **System & AI**). |
| **Start speaking** is greyed out | Use Chrome, Edge or Safari and allow the microphone, or upload a recording. |
| **Captioned video** says "Use Chrome or Edge" | Switch browser, or use **Download MP4**. |
| MP4 export says "ffmpeg is not installed" | Install ffmpeg (on a Mac, `brew install ffmpeg`), then restart the app. |
| The print view or a Hindi, Tamil, Telugu or Malayalam PDF won't open | Allow pop-ups for the app in your browser. |
| A share link doesn't work for someone | They need to be on the same network as the computer (or set `PUBLIC_BASE_URL`), the app must be running with `make start`, and the sermon must still be **Published**. |
| Someone else knows the sample accounts' password | Run `make new-demo-password` on the computer — the old password stops working at once. |

**Does the app need the internet?** Only for AI features and YouTube videos. Everything else runs on your computer.

**Who can see what I add?** Library items follow the **Who can find it?** choice; sermons stay private until you publish them.

**A library item doesn't appear on the verse I expected.** It may still be processing, or the link may be waiting for review or search-only, or the item may be private.

**Are AI answers and verse links authoritative?** No. They show their sources so you can check them against Scripture.

**Can I change a review decision?** Yes — reopen the link from the Review queue. Every change is kept in **Audit history**.

**Which translations are included?** The World English Bible, King James Version and American Standard Version (public domain), with OpenBible.info cross-references (CC-BY) and Natural Earth map data.
