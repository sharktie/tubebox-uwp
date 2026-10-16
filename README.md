# TubeBox

YouTube for **Xbox Developer Mode**, without the ads.

TubeBox runs YouTube's own TV app (the one smart TVs and consoles use) and removes its ads before they reach the player, the way uBlock Origin does on YouTube. You get the normal YouTube TV experience (your account, subscriptions, history, Shorts and search) with the ads left out.

## Features
- **No video ads.** Pre-roll, mid-roll and end ads are taken out of every video.
- **No sponsored tiles or banners** on the home screen.
- **Ad servers and ad tracking blocked** before anything leaves the console.
- **Sponsor segments skipped** with [SponsorBlock](https://sponsor.ajay.app): the sponsor reads, self-promotion and "like and subscribe" reminders inside videos, as marked by SponsorBlock's users. A short notice says what was skipped.
- **Ad filters update themselves.** When YouTube changes something, a new filter list published here reaches the app without reinstalling it (checked when the app starts, or Settings → Update ad filters).
- **Full controller support.** The controller works like a TV remote: X plays and pauses, Y searches, LB / RB skip to the previous / next video, and LT / RT rewind and fast-forward.
- **Video settings.** Limit the codec (VP9 or H.264 instead of AV1) or the maximum quality if videos stutter on your console.
- Sign in with your phone at yt.be/activate, as on a smart TV.

Press **Menu** or **View** for TubeBox's settings.

## Install on Xbox
This app is for Xbox consoles in **Developer Mode**, which is how Xbox lets you install apps from outside the Store.

1. **Turn on Developer Mode.** Follow Microsoft's guide: [Xbox Developer Mode activation](https://learn.microsoft.com/windows/uwp/xbox-apps/devkit-activation).
2. **Download the app.** On your PC, open this repository's [Releases](../../releases/latest) page, download `TubeBox-x64.zip` and unzip it. Inside is the app (`TubeBox_…_x64.msix`) and a `Dependencies` folder with its 5 dependency packages (`.appx`).
3. **Open the Device Portal.** On the Xbox, in **Dev Home**, open **Remote Access Settings**, turn on the Xbox Device Portal and set a username and password. On your PC, open the address it shows, e.g. `https://192.168.1.20:11443` (a certificate warning is expected).
4. **Install.** In the Device Portal, under **My games & apps**, choose **Add**:
   - Choose the `.msix` file and select **Next**.
   - Add the 5 files from the `Dependencies` folder and select **Next**.
   - Select **Start** and wait for the install to finish.
5. **Open it.** In Dev Home the app appears as **TubeBox**.

**Updating:** install a newer release the same way. It replaces the old version and keeps your sign-in and settings. What changed in each release is in [CHANGELOG.md](CHANGELOG.md).

## Good to know
- **A short wait instead of an ad.** On some devices YouTube's servers hold a video back for about as long as the blocked ad would have run; this is YouTube's response to ad blockers. TubeBox presents itself to YouTube as the Xbox YouTube app, which avoided the wait in testing. If YouTube changes that, a filter update can switch it without reinstalling, and TubeBox shows a notice while it waits.
- **"Confirm you're not a bot".** YouTube sometimes asks signed-out viewers to sign in, usually when a lot of signed-out viewing comes from one internet connection. Signing in avoids it.
- **SponsorBlock** sends only the first characters of a scrambled form of the video's ID, the same way SponsorBlock's browser extension does, so it can't tell what you watch. Turn it off in the settings if you prefer.
- **If ads come back**, YouTube has changed something. Open the settings and choose **Update ad filters**; a fix published here arrives that way.
- Turning off **Block ads** in the settings brings YouTube back exactly as it is.

## Troubleshooting
The app writes a log you can download from the Device Portal: **File explorer → LocalAppData →** the TubeBox package folder (`f4420250-…`) **→ LocalState → `tubebox.log`**. Include it when reporting a problem.

## Building
Every push builds signed packages with GitHub Actions (`.github/workflows/build.yml`), and pushing a tag such as `v1.0.0` publishes a release.

TubeBox is not affiliated with or endorsed by YouTube or Google.
