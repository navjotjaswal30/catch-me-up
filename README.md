# Catch Me Up

Catch Me Up helps a student who loses the thread of a recorded lecture find the earlier explanation they need and return to the exact point they left.

## Run in VS Code

1. Extract the ZIP. Install Node.js 22, Git, and VS Code.
2. In VS Code, select **File → Open Folder** and open the extracted `catch-me-up` folder containing `package.json`. You can also run `code .` from that folder.
3. Open **Terminal → New Terminal** and run:

```bash
npm ci
npm run dev
```

4. Open [localhost:3000](http://localhost:3000). For a production check, run `npm run build`.

## Try the demo

Upload the separately supplied `nested-loops.mp4` and `nested-loops.vtt` as a lecture in **CS 101**. Enable Gemini below, then jump to about **0:27** and select **I lost the thread**. The clip around **0:08** covers the earlier concept. Generated questions and recommendations can vary between requests.

## Upload a video

Select **Upload a lecture**, enter the course and lecture title, and choose an MP4 or WebM. Use the same course name to group related lectures. H.264 MP4 is a good choice for playback compatibility.

A video can play with no transcript. For timestamp-based coaching, also add a VTT, SRT, or plain text transcript with timestamps. You can attach one after upload from the transcript panel. For plain text, use one line per entry:

```text
00:00 An iteration is one pass through a loop.
00:08 The inner loop starts over for each outer iteration.
```

You can also drop a transcript onto the panel next to the player. If you have no lecture open, it attaches when you save your next video upload.

The app stores video files, transcripts, progress, and saved review in IndexedDB. They persist after closing or refreshing the page in the same browser profile and at the same URL origin. The localhost and deployed libraries start separately. Different devices and browser profiles have their own libraries, and clearing site data removes the local copy. Upload on the final Vercel URL if that is where you’ll demo.

## Enable AI coaching for uploads

Copy `.env.example` to `.env.local` in the project root and set:

```dotenv
GEMINI_API_KEY=your_google_ai_studio_key
COACH_ACCESS_CODE=your_long_random_shared_code
GEMINI_MODEL=gemini-3.5-flash-lite
```

Create your key in [Google AI Studio](https://aistudio.google.com/apikey). The default is `gemini-3.5-flash-lite`. To try `gemini-3.8-flash`, change `GEMINI_MODEL` in `.env.local`. Restart the dev server after changing environment variables. In the app, open **Settings** and enter the coach access code. Keep the API key in the server environment. The route sends selected timestamped excerpts and relevant check responses to Google Gemini when the student asks for help. The video file stays in the browser. Uploads need user-provided captions for coaching, and no automatic transcription runs.

The prototype searches a bounded set of transcript cues around the current topic and samples up to two earlier uploaded recordings in that course. It validates that suggested timestamps exist and precede the student’s current point when applicable. Test the demo files with Gemini before presenting.

## Push the code to GitHub

Create an empty GitHub repository named `catch-me-up`. Leave README, license, and .gitignore unchecked because the project already contains files. In the VS Code terminal, from the folder with `package.json`:

```bash
git init -b main
git add .
git commit -m "Build Catch Me Up prototype"
git remote add origin https://github.com/YOUR-USERNAME/catch-me-up.git
git push -u origin main
```

Replace `YOUR-USERNAME` and sign in if prompted. The included `.gitignore` excludes secrets, installed dependencies, and build output.

## Deploy on Vercel

1. Sign in to Vercel with GitHub. Select **Add New → Project** and import your repository.
2. Use the **Next.js** preset and the directory that contains `package.json`. The ZIP is structured so that this is your repository root if you run the Git commands above.
3. To enable live AI coaching, add the same server environment variables in the import screen or under **Settings → Environment Variables**. Redeploy after changing them. Video playback and the local upload library work without them.
4. Click **Deploy**, open the production URL, and upload the demo files. Future pushes to the connected production branch update the deployment.

## Where to iterate

| File | What it controls |
|---|---|
| `app/page.js` | Library, upload, player, recovery flow, review, and settings |
| `app/style.css` | Layout, colours, typography, and responsive styling |
| `lib/lecture.js` | Timestamped transcript parser |
| `lib/storage.js` | IndexedDB reads and writes |
| `app/api/coach/route.js` | Server-side AI requests, access code, and response validation |

The shared access code gates paid AI requests for a small demo. For a multi-user pilot, use account authentication, per-user rate limits, and private object storage for cross-device video access. For campus use, replace upload ingestion with authorized course recordings and transcripts.