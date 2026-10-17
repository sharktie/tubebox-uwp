# Changelog

A release's notes come from its section here (the heading must match the tag).

## v1.4.0
- The video dims behind the controls and the related videos below it again, as on other TVs.
- Related videos below a playing video no longer start a preview, which stopped the video and then took over the screen.

## v1.3.0
- Smooth animations: rows and tiles slide and fade when you move around, as on other TVs. Settings → Smooth animations turns them off if scrolling stutters on your console.
- No more black boxes behind the title, channel and times over a video; the text has a soft shadow instead.

## v1.2.0
- Shorts play inside their frame in the middle of the screen, instead of off to the left.
- The right stick should no longer move twice: on the console, TubeBox now ignores every key and scroll event the console makes from the controller and goes by its own reading of it. (If it still does, Settings → View log lists what the console sent.)
- Settings → View log shows the app's log on the TV, for reporting a problem.

## v1.1.0
- Sharper thumbnails: video tiles now load the 640x480 picture instead of 320x180.
- Focused video tiles start a preview after a few seconds again, as on other TVs.
- The left stick no longer moves twice: each push counts once, and the console's own key presses from the controller are ignored so only TubeBox's reading of it counts.

## v1.0.0
- First release: YouTube's TV app on Xbox, with video ads, sponsored tiles and ad servers blocked.
- SponsorBlock skips sponsor reads, self-promotion and subscribe reminders inside videos.
- The controller works as a TV remote: A select, B back, X play / pause, Y search, LB / RB previous / next video, LT / RT rewind / fast-forward. Menu or View opens TubeBox's settings.
- Settings: turn ad blocking and SponsorBlock off and on, limit the video codec or maximum quality, and update the ad filters.
- The ad filters update from this repository, so ad blocking can be fixed without reinstalling the app.
