# CLIProxyAPI Sidecar Integration

This document explains how OpenCowork integrates with CLIProxyAPI as a sidecar
service to provide a unified proxy endpoint for multiple providers.

## Overview

- CLIProxyAPI runs as a managed sidecar process.
- OpenCowork talks to a single endpoint (CLIProxyAPI) for all LLM traffic.
- Configuration and OAuth are managed through CLIProxyAPI management APIs, proxied
  by OpenCowork.

## Storage Layout

- `storage/cliproxyapi/config.yaml`
- `storage/cliproxyapi/auths/`
- `storage/cliproxyapi/bin/cliproxyapi*`
- `storage/cliproxyapi/management_key`
- `storage/cliproxyapi/cliproxyapi.pid`
- `storage/cliproxyapi/cliproxyapi.log`

## OAuth Notes (Remote Access)

CLIProxyAPI uses a localhost callback server for OAuth flows. If you access
OpenCowork from a remote machine, you must:

- Run the OAuth flow on the server machine, or
- Use SSH port forwarding for the callback port, or
- Use device flow providers (for example, Qwen) when available.

## Upgrade Flow

OpenCowork checks the latest CLIProxyAPI release and can download upgrades via
the Settings > CLIProxyAPI panel. A restart is required after upgrading.
