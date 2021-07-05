# Webpack Browser Extension Plugin

```shell
npm install webpack-browser-extension-plugin
```

> Only currently support webpack 4.x

This is a webpack plugin that currently just sets up some auto reloading for Browser Extensions that uses the browser API to setup some optimal reloading, with plans on Supporting HMR, and React refresh in the future.

Although there are a few other plugins out there, most of them get in the way when expanding your browser usage or upgrading to v3 of the Chrome manifest. This plugin takes all the findings from those experiences and combines it one plugin.

- Inject into bundle for background process since v3 does not support loading two files in the background service worker
- Avoid using look behind regexp to allow for usage in Safari web extensions.

> Note: This has not yet been tested on Safari, and pretty sure it might not still work due to xcode compilation issues.

## Usage

### Adding the plugin

You will want to add this plugin to the plugin array in your webpack config.

```javascript
import { BrowserExtensionPlugin } from 'webpack-browser-extension-plugin'

{
  plugins: [
    new BrowserExtensionPlugin({
      autoReload: isWatch ? true : false,
      backgroundEntry: 'background',
      ignoreEntries: ['bootstrap'],
    }),
  ]
}
```

In the example above we are setting a few options.

- **autoReload**: This tells the plugin to run the socket server, should only be done in development and when you are watching files.

- **backgroundEntry**: This tells the plugin which entry is your background entry. This is super important because the background entry orchestrates reloading of client scripts.

- **ignoreEntries** [_Optional_]: This tells the plugin which entries to not inject auto reload code into. These can be scripts that are short lived or utility scripts. **default: []**

### Structure of entries

For this plugin to work we need a named key of entries to keep track of which entry is which. For example:

```json
{
  "entry": {
    "background": "./src/background.js",
    "content": "./src/content.js"
  }
}
```

This allows the plugin to know when passing **"background"** to `backgroundEntry` what that entry is, and also which scripts should connect to the background.

## How it works

Different plugins work a bit differently. This plugin essentially uses the background process to coordinate updates. The websocket server is connected to the background process. The background process checks to see if it needs to reload, if so it messages clients that they will need to do a delayed reload because the extension context is changing. If the background script does not need to reload. It sends a message to the clients via a port to see if they need to update, if they need to update they reload on their own. Kinda like a React tree only the pieces of the tree that need to be updated are updated.

## Additional options

- **port** [_optional_]: the port for the socket server to listen on. **port: 9090**
- **host** [_optional_]: the host string that the socket server is served from. **default: localhost**
- **reconnectTime** [_optional_]: the time the plugin waits to re-establish connections to socket server and browser ports. **default: 3000**
- **quiet** [_optional_]: quiet logging in the clients, and terminal process. **default: false**

## Prior art

- [webpack-extension-reloader](https://github.com/rubenspgcavalcante/webpack-extension-reloader)
- [webpack-webextension-plugin](https://github.com/webextension-toolbox/webpack-webextension-plugin)
