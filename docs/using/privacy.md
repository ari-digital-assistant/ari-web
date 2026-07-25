# Privacy & your data

Here's the short version: Ari does its thinking on your device, and when
something *does* use the internet, it tells you. No account, no tracking.

## What happens on your device

When you say "Hey Ari", the wake word is spotted on the phone. Your speech is
turned into text on the phone. Working out what you meant happens on the phone.
There's even a small language model on board for open-ended questions, so Ari can
answer plenty with no signal at all. None of that needs the internet.

## What leaves your device — and only when you say so

A few things do use the network, always because you asked them to:

- **Cloud assistants.** If you add ChatGPT, Claude or Gemini for the big
  questions, your question goes to that provider, with your own API key. Entirely
  optional.
- **Skills with a job to do.** Asking for the weather or turning off the lights
  means talking to a weather service or your smart home. That's the point of them.
- **Every skill is labelled** on-device or uses-network, so you know before you
  install.

## No account, no telemetry

There's nothing to sign up for. No analytics counting your taps, no crash-reporter
phoning home. Ari doesn't ship an analytics SDK — we didn't put one in.

## See for yourself

Ari is open-source, top to bottom — the engine, the apps, and the signed skills
registry. Read the code on [GitHub](https://github.com/ari-digital-assistant).
