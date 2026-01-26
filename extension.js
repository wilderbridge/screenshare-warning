/* exported init */

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class ScreenShareWarning extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._settings.set_boolean('preview-active', false);
    this._borderArmed = false;
    this._lastPreviewActive = false;
    this._ignoreRemoteHandles = true;
    this._suppressBorders = true;
    this._ignoreRemoteHandlesId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      this._ignoreRemoteHandles = false;
      this._ignoreRemoteHandlesId = null;
      return GLib.SOURCE_REMOVE;
    });

    // Built-in screen sharing indicator (GNOME Shell 43+ exposes it here)
    this._indicator = Main.panel.statusArea?.screenSharing;

    // Fallback: if GNOME internals differ, fail gracefully
    if (!this._indicator) {
      console.warn('[ssw] No screenSharing indicator found in Main.panel.statusArea');
      return;
    }

    // Create a label on the panel (center box)
    this._label = new St.Label({
      text: this._getWarningText(),
      style_class: 'ssw-label',
      y_align: Clutter.ActorAlign.CENTER,
      visible: false,
    });
    this._applyLabelStyle();

    // Put label in the center box so it is always obvious
    const centerBox = Main.panel._centerBox || Main.panel._leftBox;
    centerBox.insert_child_at_index(this._label, 0);

    // Remember original panel styles for later restore
    this._panelActor = Main.panel.actor ?? Main.panel;
    this._panelStyle = this._panelActor?.get_style?.() ?? '';
    this._panelInner = Main.panel._panel || null;
    this._panelInnerStyle = this._panelInner ? this._panelInner.get_style() : null;
    this._theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
    const cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'screenshare-warning']);
    GLib.mkdir_with_parents(cacheDir, 0o755);
    this._colorCssFile = Gio.File.new_for_path(GLib.build_filenamev([cacheDir, 'panel-color.css']));
    this._updatePanelStylesheet();
    this._borderActor = this._createBorderActor();
    this._borderActor.visible = false;
    this._borderActor.opacity = 0;
    Main.layoutManager.addChrome(this._borderActor, { trackFullscreen: true });
    this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
      this._updateBorderGeometry();
    });
    if (Main.overview) {
      this._overviewShowingId = Main.overview.connect('showing', () => {
        if (this._borderActor) {
          this._borderActor.visible = false;
        }
        this._sync();
      });
      this._overviewHiddenId = Main.overview.connect('hidden', () => {
        this._sync();
      });
    }

    this._remoteShareCount = 0;
    this._remoteHandleStops = new Map();
    if (Meta.is_wayland_compositor()) {
      this._remoteAccessController = global.backend.get_remote_access_controller();
      if (this._remoteAccessController) {
        this._remoteHandleAddedId = this._remoteAccessController.connect('new-handle', (_, handle) => {
          if (this._ignoreRemoteHandles) {
            return;
          }
          const stopId = handle.connect('stopped', () => {
            handle.disconnect(stopId);
            this._remoteHandleStops.delete(handle);
            this._remoteShareCount = Math.max(0, this._remoteShareCount - 1);
            this._sync();
          });
          this._remoteHandleStops.set(handle, stopId);
          if (!handle.is_recording) {
            this._remoteShareCount += 1;
            this._borderArmed = true;
            this._suppressBorders = false;
          }
          this._sync();
        });
      }
    }

    // Watch indicator visibility (proxy for "sharing active")
    this._visChangedId = this._indicator.connect('notify::visible', () => this._sync());
    this._textChangedId = this._settings.connect('changed::warning-text', () => this._syncText());
    this._textColorChangedId = this._settings.connect('changed::text-color', () => this._applyLabelStyle());
    this._colorChangedId = this._settings.connect('changed::panel-color', () => this._refreshPanelStyle());
    this._blinkChangedId = this._settings.connect('changed::blink-interval-ms', () => this._refreshBlinkInterval());
    this._borderEnabledChangedId = this._settings.connect('changed::border-enabled', () => this._updateBorderVisibility());
    this._borderWidthChangedId = this._settings.connect('changed::border-width', () => this._refreshPanelStyle());
    this._previewChangedId = this._settings.connect('changed::preview-active', () => this._sync());

    this._syncText();
    this._sync();
  }

  disable() {
    if (this._blinkSource) {
      GLib.Source.remove(this._blinkSource);
      this._blinkSource = null;
    }

    if (this._indicator && this._visChangedId) {
      this._indicator.disconnect(this._visChangedId);
      this._visChangedId = null;
    }
    if (this._ignoreRemoteHandlesId) {
      GLib.Source.remove(this._ignoreRemoteHandlesId);
      this._ignoreRemoteHandlesId = null;
    }

    if (this._settings) {
      if (this._textChangedId) {
        this._settings.disconnect(this._textChangedId);
        this._textChangedId = null;
      }
      if (this._colorChangedId) {
        this._settings.disconnect(this._colorChangedId);
        this._colorChangedId = null;
      }
      if (this._textColorChangedId) {
        this._settings.disconnect(this._textColorChangedId);
        this._textColorChangedId = null;
      }
      if (this._blinkChangedId) {
        this._settings.disconnect(this._blinkChangedId);
        this._blinkChangedId = null;
      }
      if (this._previewChangedId) {
        this._settings.disconnect(this._previewChangedId);
        this._previewChangedId = null;
      }
      if (this._borderEnabledChangedId) {
        this._settings.disconnect(this._borderEnabledChangedId);
        this._borderEnabledChangedId = null;
      }
      if (this._borderWidthChangedId) {
        this._settings.disconnect(this._borderWidthChangedId);
        this._borderWidthChangedId = null;
      }
      this._settings = null;
    }

    if (this._label) {
      this._label.destroy();
      this._label = null;
    }

    // Remove panel highlight if present
    if (this._panelActor) {
      this._panelActor.remove_style_class_name('ssw-panel-on');
    }

    if (this._panelStyle !== undefined && this._panelActor) {
      this._panelActor.set_style(this._panelStyle || '');
      this._panelStyle = undefined;
    }

    if (this._panelInner) {
      this._panelInner.set_style(this._panelInnerStyle || '');
      this._panelInner = null;
      this._panelInnerStyle = null;
    }
    this._panelActor = null;
    if (this._theme && this._colorCssFile && this._colorCssLoaded) {
      this._theme.unload_stylesheet(this._colorCssFile);
      this._colorCssLoaded = false;
    }
    this._theme = null;
    this._colorCssFile = null;

    this._indicator = null;
    this._borderArmed = false;
    this._lastPreviewActive = false;
    this._ignoreRemoteHandles = false;
    this._suppressBorders = false;
    if (this._monitorsChangedId) {
      Main.layoutManager.disconnect(this._monitorsChangedId);
      this._monitorsChangedId = null;
    }
    if (this._overviewShowingId) {
      Main.overview.disconnect(this._overviewShowingId);
      this._overviewShowingId = null;
    }
    if (this._overviewHiddenId) {
      Main.overview.disconnect(this._overviewHiddenId);
      this._overviewHiddenId = null;
    }
    if (this._remoteAccessController && this._remoteHandleAddedId) {
      this._remoteAccessController.disconnect(this._remoteHandleAddedId);
      this._remoteHandleAddedId = null;
    }
    for (const [handle, stopId] of this._remoteHandleStops ?? []) {
      handle.disconnect(stopId);
    }
    this._remoteHandleStops?.clear();
    this._remoteHandleStops = null;
    this._remoteAccessController = null;
    this._remoteShareCount = 0;
    if (this._borderActor) {
      this._borderActor.destroy();
      this._borderActor = null;
    }
  }

  _getWarningText() {
    const text = this._settings?.get_string('warning-text') || '';
    return text.trim() || 'SCREEN IS BEING SHARED';
  }

  _getPanelColor() {
    const color = this._settings?.get_string('panel-color') || '';
    return color.trim() || '#ff7a00';
  }

  _getTextColor() {
    const color = this._settings?.get_string('text-color') || '';
    return color.trim() || '#ffffff';
  }

  _getBlinkIntervalMs() {
    const interval = this._settings?.get_int('blink-interval-ms') ?? 500;
    return Math.max(100, interval);
  }

  _getBorderEnabled() {
    return !!this._settings?.get_boolean('border-enabled');
  }

  _getBorderWidth() {
    const width = this._settings?.get_int('border-width') ?? 3;
    return Math.max(1, Math.min(5, width));
  }

  _getPreviewActive() {
    return !!this._settings?.get_boolean('preview-active');
  }

  _isSharingActive() {
    if (!this._indicator) {
      return false;
    }
    if (this._remoteShareCount > 0) {
      return true;
    }

    return false;
  }

  _syncText() {
    if (this._label) {
      this._label.text = this._getWarningText();
    }
  }

  _ensurePanelBindings() {
    const panelActor = Main.panel.actor ?? Main.panel;
    if (panelActor !== this._panelActor) {
      if (this._panelActor) {
        this._panelActor.remove_style_class_name('ssw-panel-on');
      }
      this._panelActor = panelActor;
      this._panelStyle = this._panelActor?.get_style?.() ?? '';
    }

    const panelInner = Main.panel._panel || null;
    if (panelInner !== this._panelInner) {
      this._panelInner = panelInner;
      this._panelInnerStyle = this._panelInner ? this._panelInner.get_style() : null;
    }

    if (this._label) {
      const centerBox = Main.panel._centerBox || Main.panel._leftBox;
      const parent = this._label.get_parent?.();
      if (centerBox && parent !== centerBox) {
        if (parent?.remove_child) {
          parent.remove_child(this._label);
        }
        centerBox.insert_child_at_index(this._label, 0);
      }
    }
  }

  _createBorderActor() {
    const actor = new St.Widget({
      style_class: 'ssw-screen-border',
      reactive: false,
      visible: false,
    });
    this._updateBorderGeometry(actor);
    return actor;
  }

  _updateBorderGeometry(actor = this._borderActor) {
    if (!actor || !Main.layoutManager.primaryMonitor) {
      return;
    }
    const monitor = Main.layoutManager.primaryMonitor;
    actor.set_position(monitor.x, monitor.y);
    actor.set_size(monitor.width, monitor.height);
  }

  _updateBorderVisibility() {
    if (!this._borderActor) {
      return;
    }
    const panelTagged = !!this._panelActor?.has_style_class_name?.('ssw-panel-on');
    const allowInOverview = !Main.overview?.visible;
    const sharingNow = this._isSharingActive() || this._getPreviewActive();
    if (this._suppressBorders) {
      this._borderActor.visible = false;
      this._borderActor.opacity = 0;
      return;
    }
    const shouldShow = !!(
      this._borderArmed &&
      allowInOverview &&
      sharingNow &&
      this._getBorderEnabled() &&
      panelTagged
    );
    this._borderActor.visible = shouldShow;
    this._borderActor.opacity = shouldShow ? 255 : 0;
  }

  _updatePanelStylesheet() {
    if (!this._theme || !this._colorCssFile) {
      return;
    }
    const color = this._getPanelColor();
    const borderWidth = this._getBorderWidth();
    const css = [
      '#panel.ssw-panel-on,',
      '.panel.ssw-panel-on {',
      `  background-color: ${color} !important;`,
      '  background-image: none !important;',
      '}',
      '',
      '#panel.ssw-panel-on .panel-background,',
      '.panel.ssw-panel-on .panel-background {',
      `  background-color: ${color} !important;`,
      '  background-image: none !important;',
      '}',
      '',
      '.ssw-screen-border {',
      `  border: ${borderWidth}px solid ${color};`,
      '  background: transparent;',
      '}',
      '',
    ].join('\n');

    GLib.file_set_contents(this._colorCssFile.get_path(), css);
    if (this._colorCssLoaded) {
      this._theme.unload_stylesheet(this._colorCssFile);
    }
    this._theme.load_stylesheet(this._colorCssFile);
    this._colorCssLoaded = true;
  }

  _applyLabelStyle() {
    if (!this._label) {
      return;
    }
    const baseStyle = 'font-weight: 700; padding: 0 12px;';
    this._label.set_style(`${baseStyle} color: ${this._getTextColor()};`);
  }

  _refreshPanelStyle() {
    this._updatePanelStylesheet();
    if (this._sharingActive) {
      this._applyPanelStyle(true);
    }
  }

  _refreshBlinkInterval() {
    if (this._sharingActive) {
      this._restartBlink();
    }
  }

  _sync() {
    this._ensurePanelBindings();
    const previewActive = this._getPreviewActive();
    if (previewActive && !this._lastPreviewActive) {
      this._borderArmed = true;
      this._suppressBorders = false;
    }
    this._lastPreviewActive = previewActive;
    const sharing = this._isSharingActive() || previewActive;
    this._sharingActive = sharing;

    if (sharing) {
      if (this._panelActor) {
        this._panelActor.add_style_class_name('ssw-panel-on');
      }
      this._label.visible = true;
      this._setBlinkState(true);
      this._updateBorderVisibility();

      // Start blinking
      if (!this._blinkSource) {
        this._restartBlink();
      }
    } else {
      if (this._panelActor) {
        this._panelActor.remove_style_class_name('ssw-panel-on');
      }
      this._label.visible = false;
      this._label.remove_style_class_name('ssw-hidden');
      this._setBlinkState(false);
      this._updateBorderVisibility();

      if (this._blinkSource) {
        GLib.Source.remove(this._blinkSource);
        this._blinkSource = null;
      }
    }
  }

  _restartBlink() {
    if (this._blinkSource) {
      GLib.Source.remove(this._blinkSource);
      this._blinkSource = null;
    }

    if (!this._sharingActive) {
      return;
    }

    this._blinkOn = true;
    this._setBlinkState(true);
    this._blinkSource = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      this._getBlinkIntervalMs(),
      () => {
        if (!this._sharingActive) {
          return GLib.SOURCE_REMOVE;
        }
        this._blinkOn = !this._blinkOn;
        this._setBlinkState(this._blinkOn);
        return GLib.SOURCE_CONTINUE;
      }
    );
  }

  _setBlinkState(on) {
    if (!this._sharingActive) {
      this._applyPanelStyle(false);
      if (this._label) {
        this._label.opacity = 255;
      }
      return;
    }

    if (this._label) {
      this._label.visible = on;
    }

    // Blink the panel too so the warning is always visible
    this._applyPanelStyle(on);
  }

  _applyPanelStyle(active) {
    if (active) {
      this._updatePanelStylesheet();
      return;
    }
    // Styles are theme-driven; nothing to restore when inactive.
  }
}
