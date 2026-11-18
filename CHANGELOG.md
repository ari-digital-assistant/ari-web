# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `POST /api/bug/<id>/status` tells the app how many people have replied on a report's
  issue, so it can let the tester know. It asks for the report's delete token, as
  withdrawing does, and leaves bots' comments out of the count.

- Bug reports keep and show the device's chip, its CPU features, and which processor
  build the on-device assistant runs
  ([ari-android#32](https://github.com/ari-digital-assistant/ari-android/issues/32)).

### Changed

- The deploy's dependency audit can accept a named advisory that has no fix yet. It
  accepts picomatch's GHSA-fc5q-39xc-vjpf, which only touches build-time globbing,
  and stops accepting it by itself once a fixed release exists.

### Fixed

- The report link in each bug-report issue (`/reports/<id>`) opens that report instead
  of an error page, and still opens it after signing in
  ([ari-android#35](https://github.com/ari-digital-assistant/ari-android/issues/35)).
