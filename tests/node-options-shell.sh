#!/bin/sh
# A login shell, as the app reads its environment (electron/shell-env.ts), whose startup sets NODE_OPTIONS to a flag
# Electron's Node does not take: what a person who builds older webpack projects often has in ~/.zshrc.
NODE_OPTIONS=--openssl-legacy-provider exec /bin/sh -c "$2"
