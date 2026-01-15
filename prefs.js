import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import Gdk from 'gi://Gdk?version=4.0';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const DEFAULT_TEXT = 'SCREEN IS BEING SHARED';
const DEFAULT_COLOR = '#ff7a00';
const DEFAULT_TEXT_COLOR = '#ffffff';
const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

function normalizeHex(value) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!HEX_RE.test(trimmed)) {
    return null;
  }
  return trimmed.startsWith('#') ? trimmed.toLowerCase() : `#${trimmed.toLowerCase()}`;
}

function rgbaFromHex(hex) {
  const rgba = new Gdk.RGBA();
  if (hex && rgba.parse(hex)) {
    return rgba;
  }
  return null;
}

function rgbaToHex(rgba) {
  const r = Math.round(rgba.red * 255);
  const g = Math.round(rgba.green * 255);
  const b = Math.round(rgba.blue * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function createColorPreview(initialRgba) {
  let current = initialRgba;
  const preview = new Gtk.DrawingArea({
    content_width: 28,
    content_height: 18,
    valign: Gtk.Align.CENTER,
  });

  preview.set_draw_func((area, cr, width, height) => {
    const rgba = current || new Gdk.RGBA({ red: 1, green: 1, blue: 1, alpha: 1 });
    cr.setSourceRGBA(rgba.red, rgba.green, rgba.blue, 1);
    cr.rectangle(0, 0, width, height);
    cr.fill();

    cr.setSourceRGBA(0, 0, 0, 0.3);
    cr.rectangle(0.5, 0.5, width - 1, height - 1);
    cr.stroke();
  });

  return {
    widget: preview,
    setRgba(rgba) {
      current = rgba;
      preview.queue_draw();
    },
  };
}

export default class ScreenShareWarningPrefs extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();
    const page = new Adw.PreferencesPage();
    settings.set_boolean('preview-active', false);

    const group = new Adw.PreferencesGroup({ title: 'Appearance' });

    const textRow = new Adw.EntryRow({
      title: 'Warning text',
      text: settings.get_string('warning-text') || DEFAULT_TEXT,
    });
    textRow.connect('notify::text', () => {
      settings.set_string('warning-text', textRow.text || DEFAULT_TEXT);
    });
    group.add(textRow);

    const panelColorRow = new Adw.ActionRow({
      title: 'Panel background color',
      subtitle: 'Shown when screen sharing is active',
    });

    const initialHex = normalizeHex(settings.get_string('panel-color')) || DEFAULT_COLOR;
    const preview = createColorPreview(rgbaFromHex(initialHex));
    panelColorRow.add_suffix(preview.widget);

    if ('ColorDialogButton' in Gtk && 'ColorDialog' in Gtk) {
      const dialog = new Gtk.ColorDialog();
      const button = new Gtk.ColorDialogButton({ dialog, valign: Gtk.Align.CENTER });
      const initialRgba = rgbaFromHex(initialHex);
      if (initialRgba) {
        button.rgba = initialRgba;
      }
      button.connect('notify::rgba', () => {
        const hex = rgbaToHex(button.rgba);
        settings.set_string('panel-color', hex);
        preview.setRgba(button.rgba);
      });
      panelColorRow.add_suffix(button);
      panelColorRow.activatable_widget = button;
    } else {
      const entry = new Gtk.Entry({
        valign: Gtk.Align.CENTER,
        width_chars: 8,
        text: initialHex,
      });
      entry.connect('changed', () => {
        const normalized = normalizeHex(entry.text);
        if (!normalized) {
          return;
        }
        settings.set_string('panel-color', normalized);
        preview.setRgba(rgbaFromHex(normalized));
      });
      panelColorRow.add_suffix(entry);
      panelColorRow.activatable_widget = entry;
    }

    group.add(panelColorRow);

    const textColorRow = new Adw.ActionRow({
      title: 'Warning text color',
    });
    const textHex = normalizeHex(settings.get_string('text-color')) || DEFAULT_TEXT_COLOR;
    const textPreview = createColorPreview(rgbaFromHex(textHex));
    textColorRow.add_suffix(textPreview.widget);

    if ('ColorDialogButton' in Gtk && 'ColorDialog' in Gtk) {
      const dialog = new Gtk.ColorDialog();
      const button = new Gtk.ColorDialogButton({ dialog, valign: Gtk.Align.CENTER });
      const initialRgba = rgbaFromHex(textHex);
      if (initialRgba) {
        button.rgba = initialRgba;
      }
      button.connect('notify::rgba', () => {
        const hex = rgbaToHex(button.rgba);
        settings.set_string('text-color', hex);
        textPreview.setRgba(button.rgba);
      });
      textColorRow.add_suffix(button);
      textColorRow.activatable_widget = button;
    } else {
      const entry = new Gtk.Entry({
        valign: Gtk.Align.CENTER,
        width_chars: 8,
        text: textHex,
      });
      entry.connect('changed', () => {
        const normalized = normalizeHex(entry.text);
        if (!normalized) {
          return;
        }
        settings.set_string('text-color', normalized);
        textPreview.setRgba(rgbaFromHex(normalized));
      });
      textColorRow.add_suffix(entry);
      textColorRow.activatable_widget = entry;
    }

    group.add(textColorRow);

    const blinkRow = new Adw.ActionRow({
      title: 'Blink interval (ms)',
      subtitle: 'Lower values blink faster',
    });
    const blinkSpin = new Gtk.SpinButton({
      adjustment: new Gtk.Adjustment({ lower: 100, upper: 5000, step_increment: 50, page_increment: 250 }),
      digits: 0,
      valign: Gtk.Align.CENTER,
      width_chars: 6,
      halign: Gtk.Align.END,
    });
    settings.bind('blink-interval-ms', blinkSpin, 'value', Gio.SettingsBindFlags.DEFAULT);
    blinkRow.add_suffix(blinkSpin);
    blinkRow.activatable_widget = blinkSpin;
    group.add(blinkRow);

    const borderRow = new Adw.ActionRow({
      title: 'Screen border',
      subtitle: 'Draw a border around the primary monitor',
    });
    const borderSwitch = new Gtk.Switch({
      valign: Gtk.Align.CENTER,
    });
    borderSwitch.connect('notify::active', () => {
      settings.set_boolean('border-enabled', borderSwitch.active);
    });
    settings.bind('border-enabled', borderSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    borderRow.add_suffix(borderSwitch);
    borderRow.activatable_widget = borderSwitch;
    group.add(borderRow);

    const borderWidthRow = new Adw.ActionRow({
      title: 'Border width (px)',
      subtitle: 'Thickness between 1 and 5 pixels',
    });
    const borderWidthSpin = new Gtk.SpinButton({
      adjustment: new Gtk.Adjustment({ lower: 1, upper: 5, step_increment: 1, page_increment: 1 }),
      digits: 0,
      valign: Gtk.Align.CENTER,
      width_chars: 4,
      halign: Gtk.Align.END,
    });
    settings.bind('border-width', borderWidthSpin, 'value', Gio.SettingsBindFlags.DEFAULT);
    borderWidthRow.add_suffix(borderWidthSpin);
    borderWidthRow.activatable_widget = borderWidthSpin;
    group.add(borderWidthRow);

    const syncBorderWidthSensitivity = () => {
      borderWidthSpin.sensitive = borderSwitch.active;
    };
    borderSwitch.connect('notify::active', syncBorderWidthSensitivity);
    syncBorderWidthSensitivity();

    const previewRow = new Adw.ActionRow({
      title: 'Preview warning',
      subtitle: 'Toggle the warning without screen sharing',
    });
    const previewToggle = new Gtk.ToggleButton({
      label: 'Preview',
      valign: Gtk.Align.CENTER,
      active: false,
    });
    previewToggle.connect('toggled', () => {
      settings.set_boolean('preview-active', previewToggle.active);
    });
    previewRow.add_suffix(previewToggle);
    previewRow.activatable_widget = previewToggle;
    group.add(previewRow);

    window.connect('close-request', () => {
      settings.set_boolean('preview-active', false);
      previewToggle.active = false;
      return false;
    });

    page.add(group);
    window.set_default_size(520, 480);
    window.add(page);
  }
}
