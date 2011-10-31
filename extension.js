// Copyright (C) 2011 R M Yorston
// Licence: GPLv2+

const Clutter = imports.gi.Clutter;
const Gettext = imports.gettext;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Meta = imports.gi.Meta;
const Pango = imports.gi.Pango;
const Shell = imports.gi.Shell;
const Signals = imports.signals;
const St = imports.gi.St;

const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const ModalDialog = imports.ui.modalDialog;
const WindowManager = imports.ui.windowManager;

let _f;

function WindowListItem(app, metaWindow) {
    this._init(app, metaWindow);
}

WindowListItem.prototype = {
    _init: function(app, metaWindow) {
        this.actor = new St.BoxLayout({ style_class: 'window-list-item-box',
                                        reactive: true,
                                        can_focus: true });
        this._delegate = this;
        this.metaWindow = metaWindow;

        this.icon = app.create_icon_texture(16);
        let title = metaWindow.title;
        //this.actor.set_tooltip_text(title);
        if ( !metaWindow.showing_on_its_workspace() ) {
            title = '[' + title + ']';
        }
        this.label = new St.Label({ style_class: 'window-list-item-label',
                                    text: title });
        this.label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.actor.add(this.icon, { x_fill: false, y_fill: false });
        this.actor.add(this.label, { x_fill: true, y_fill: false });

        this._notifyTitleId = metaWindow.connect('notify::title', Lang.bind(this, this._onTitleChanged));
        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
        this.actor.connect('button-press-event', Lang.bind(this, this._onButtonPress));
    },

     _onTitleChanged: function(w) {
         let title = w.title;
         //this.actor.set_tooltip_text(title);
         if ( !w.showing_on_its_workspace() ) {
             title = '[' + title + ']';
         }
         this.label.text = title;
    },

    _onDestroy: function() {
        this.metaWindow.disconnect(this._notifyTitleId);
    },

    _onButtonPress: function() {
        if ( this.metaWindow.has_focus() ) {
            this.metaWindow.minimize(global.get_current_time());
        }
        else {
            this.metaWindow.activate(global.get_current_time());
        }
    },

    doMinimize: function() {
        this.label.text = '[' + this.metaWindow.title + ']';
        this.icon.opacity = 127;
    },

    doMap: function() {
        this.label.text = this.metaWindow.title;
        this.icon.opacity = 255;
    },

    doFocus: function() {
        if ( this.metaWindow.has_focus() ) {
            this.actor.add_style_pseudo_class('focused');
        }
        else {
            this.actor.remove_style_pseudo_class('focused');
        }
    }
};

function WindowList() {
    this._init();
}

WindowList.prototype = {
    _init: function() {
        this.actor = new St.BoxLayout({ name: 'windowList',
                                        style_class: 'window-list-box' });
        this.actor._delegate = this;
        this._windows = [];

        let tracker = Shell.WindowTracker.get_default();
        tracker.connect('notify::focus-app', Lang.bind(this, this._onFocus));

        global.window_manager.connect('switch-workspace',
                                        Lang.bind(this, this._refreshItems));
        global.window_manager.connect('minimize',
                                        Lang.bind(this, this._onMinimize));
        global.window_manager.connect('map', Lang.bind(this, this._onMap));

        this._workspaces = [];
        this._changeWorkspaces();

        global.screen.connect('notify::n-workspaces',
                                Lang.bind(this, this._changeWorkspaces));
    },

    _onFocus: function() {
        for ( let i = 0; i < this._windows.length; ++i ) {
            this._windows[i].doFocus();
        }
    },

    _refreshItems: function() {
        this.actor.destroy_children();
        this._windows = [];

        let metaWorkspace = global.screen.get_active_workspace();
        let windows = metaWorkspace.list_windows();
        windows.sort(function(w1, w2) {
            return w1.get_stable_sequence() - w2.get_stable_sequence();
        });

        // Create list items for each window
        let tracker = Shell.WindowTracker.get_default();
        for ( let i = 0; i < windows.length; ++i ) {
            let metaWindow = windows[i];
            if ( metaWindow && tracker.is_window_interesting(metaWindow) ) {
                let app = tracker.get_window_app(metaWindow);
                if ( app ) {
                    let item = new WindowListItem(app, metaWindow);
                    this._windows.push(item);
                    this.actor.add(item.actor);
                }
            }
        }

        this._onFocus();
    },

    _onMinimize: function(shellwm, actor) {
        for ( let i=0; i<this._windows.length; ++i ) {
            if ( this._windows[i].metaWindow == actor.get_meta_window() ) {
                this._windows[i].doMinimize();
                return;
            }
        }
    },

    _onMap: function(shellwm, actor) {
        for ( let i=0; i<this._windows.length; ++i ) {
            if ( this._windows[i].metaWindow == actor.get_meta_window() ) {
                this._windows[i].doMap();
                return;
            }
        }
    },

    _windowAdded: function(metaWorkspace, metaWindow) {
        if ( metaWorkspace.index() != global.screen.get_active_workspace_index() ) {
            return;
        }

        for ( let i=0; i<this._windows.length; ++i ) {
            if ( this._windows[i].metaWindow == metaWindow ) {
                return;
            }
        }

        let tracker = Shell.WindowTracker.get_default();
        let app = tracker.get_window_app(metaWindow);
        if ( app && tracker.is_window_interesting(metaWindow) ) {
            let item = new WindowListItem(app, metaWindow);
            this._windows.push(item);
            this.actor.add(item.actor);
        }
    },

    _windowRemoved: function(metaWorkspace, metaWindow) {
        if ( metaWorkspace.index() != global.screen.get_active_workspace_index() ) {
            return;
        }

        for ( let i=0; i<this._windows.length; ++i ) {
            if ( this._windows[i].metaWindow == metaWindow ) {
                this.actor.remove_actor(this._windows[i].actor);
                this._windows[i].actor.destroy();
                this._windows.splice(i, 1);
                break;
            }
        }
    },

    _changeWorkspaces: function() {
        for ( let i=0; i<this._workspaces.length; ++i ) {
            let ws = this._workspaces[i];
            ws.disconnect(ws._windowAddedId);
            ws.disconnect(ws._windowRemovedId);
        }

        this._workspaces = [];
        for ( let i=0; i<global.screen.n_workspaces; ++i ) {
            let ws = global.screen.get_workspace_by_index(i);
            this._workspaces[i] = ws;
            ws._windowAddedId = ws.connect('window-added',
                                    Lang.bind(this, this._windowAdded));
            ws._windowRemovedId = ws.connect('window-removed',
                                    Lang.bind(this, this._windowRemoved));
        }
    }
};

function WorkspaceDialog() {
    this._init();
}

WorkspaceDialog.prototype = {
    __proto__: ModalDialog.ModalDialog.prototype,

    _init: function() {
        ModalDialog.ModalDialog.prototype._init.call(this, { styleClass: 'workspace-dialog' });

        let label = new St.Label({ style_class: 'workspace-dialog-label',
                                   text: _f('Number of workspaces') });

        this.contentLayout.add(label, { y_align: St.Align.START });

        let entry = new St.Entry({ style_class: 'workspace-dialog-entry' });

        this._entryText = entry.clutter_text;
        this.contentLayout.add(entry, { y_align: St.Align.START });
        this.setInitialKeyFocus(this._entryText);

        this._entryText.connect('key-press-event', Lang.bind(this, function(o, e) {
            let symbol = e.get_key_symbol();
            if (symbol == Clutter.Return || symbol == Clutter.KP_Enter) {
                let num = parseInt(o.get_text());
                if ( !isNaN(num) && num >= 2 && num <= 32 ) {
                    let old_num = global.screen.n_workspaces;
                    if ( num > old_num ) {
                        for ( let i=old_num; i<num; ++i ) {
                            global.screen.append_new_workspace(false,
                                    global.get_current_time());
                        }
                    }
                    else if ( num < old_num ) {
                        for ( let i=old_num-1; i>=num; --i ) {
                            let ws = global.screen.get_workspace_by_index(i);
                            global.screen.remove_workspace(ws,
                                    global.get_current_time());
                        }
                    }
                }
                this.close();
                return true;
            }
            if (symbol == Clutter.Escape) {
                this.close();
                return true;
            }
            return false;
        }));
    },

    open: function() {
        this._entryText.set_text(''+global.screen.n_workspaces);
        this._commandError = false;

        ModalDialog.ModalDialog.prototype.open.call(this);
    }
};
Signals.addSignalMethods(WorkspaceDialog.prototype);

function WorkspaceSwitcher() {
    this._init();
}

WorkspaceSwitcher.prototype = {
    _init: function() {
        this.actor = new St.BoxLayout({ name: 'workspaceSwitcher',
                                        style_class: 'workspace-switcher',
                                        reactive: true });
        this.actor.connect('button-release-event', this._showDialog);
        this.actor._delegate = this;
        this.button = [];
        this._createButtons();

        global.screen.connect('notify::n-workspaces',
                                Lang.bind(this, this._createButtons));
        global.window_manager.connect('switch-workspace',
                                Lang.bind(this, this._updateButtons));
    },

    _createButtons: function() {
        for ( let i=0; i<this.button.length; ++i ) {
            this.button[i].destroy();
        }

        this.button = [];
        for ( let i=0; i<global.screen.n_workspaces; ++i ) {
            this.button[i] = new St.Button({ name: 'workspaceButton',
                                     style_class: 'workspace-button',
                                     reactive: true });
            let text = '';
            if ( i == global.screen.get_active_workspace_index() ) {
                text = '-' + (i+1).toString() + '-';
                this.button[i].add_style_pseudo_class('outlined');
            }
            else {
                text = (i+1).toString();
            }
            let label = new St.Label({ text: text });
            this.button[i].set_child(label);
            this.actor.add(this.button[i]);
            let index = i;
            this.button[i].connect('clicked', Lang.bind(this, function() {
                let metaWorkspace = global.screen.get_workspace_by_index(index);
                metaWorkspace.activate(global.get_current_time());
            }));
        }
    },

    _updateButtons: function() {
        for ( let i=0; i<this.button.length; ++i ) {
            if ( i == global.screen.get_active_workspace_index() ) {
                this.button[i].get_child().set_text('-' + (i+1).toString() + '-');
                this.button[i].add_style_pseudo_class('outlined');
            }
            else {
                this.button[i].get_child().set_text((i+1).toString());
                this.button[i].remove_style_pseudo_class('outlined');
            }
        }
    },

    _showDialog: function(actor, event) {
        let button = event.get_button();
        if ( button == 3 ) {
            if ( this._workspaceDialog == null ) {
                this._workspaceDialog = new WorkspaceDialog();
            }
            this._workspaceDialog.open();
            return true;
        }
        return false;
    }
};



MessageTray.MessageTray.prototype.toggle = function() {
    if (this._summaryState == MessageTray.State.SHOWN) {
        this._pointerInSummary = false;
    }
    else {
        this._pointerInSummary = true;
    }
    this._updateState();
};


function MessageButton() {
    this._init();
}

MessageButton.prototype = {
    _init: function() {
        this.actor = new St.Button({ name: 'messageButton',
                                     style_class: 'message-button',
                                     reactive: true });
        this.messageLabel = new St.Label({ text: '!' });
        this.actor.set_child(this.messageLabel);
        this.actor.connect('clicked', Lang.bind(this, function() {
            Main.messageTray.toggle();
        }));
    }
};


function BottomPanel(path) {
    this._init(path);
}

BottomPanel.prototype = {
    _init : function(path) {
        this.actor = new St.BoxLayout({ style_class: 'bottom-panel',
                                        name: 'bottomPanel',
                                        reactive: true });
        this.actor._delegate = this;
        this._path = path;

        let windowList = new WindowList();
        this.actor.add(windowList.actor, { expand: true, y_fill: false });

        let workspaceSwitcher = new WorkspaceSwitcher();
        this.actor.add(workspaceSwitcher.actor, { y_fill: false });

        let messageButton = new MessageButton();
        this.actor.add(messageButton.actor);

        this._overviewVisible = false;
        Main.layoutManager._chrome.addActor(this.actor, { visibleInFullscreen: false, affectsStruts: true });

        this.actor.connect('style-changed', Lang.bind(this, this.relayout));
        global.screen.connect('monitors-changed', Lang.bind(this,
                                                     this.relayout));

        let themeContext = St.ThemeContext.get_for_stage(global.stage);
        themeContext.connect('changed', Lang.bind(this, this._themeChanged));
    },

    _themeChanged: function(themeContext) {
        let theme = themeContext.get_theme();
        let dir = Gio.file_new_for_path(this._path);
        let stylesheetFile = dir.get_child('stylesheet.css');
        if (stylesheetFile.query_exists(null)) {
            try {
                theme.load_stylesheet(stylesheetFile.get_path());
            } catch (e) {
                global.logError(baseErrorString + 'Stylesheet parse error: ' + e);
                return;
            }
        }
    },

    relayout: function() {
        let primary = Main.layoutManager.primaryMonitor;

        let h = this.actor.get_theme_node().get_height();
        this.actor.set_position(primary.x, primary.y+primary.height-h);
        this.actor.set_size(primary.width, -1);
    },
};

function DummyWorkspaceSwitcherPopup() {
    this._init();
}

DummyWorkspaceSwitcherPopup.prototype = {
    _init: function() {
        this.actor = new St.Group({ reactive: true,
                                         x: 0,
                                         y: 0,
                                         width: global.screen_width,
                                         height: global.screen_height,
                                         style_class: 'workspace-switcher-group' });
    },

    display: function(direction, index) {
    }
};
 
function main(meta) {
    let localePath = meta.path + '/locale';

    Gettext.bindtextdomain('gnome-shell-frippery', localePath);

    _f = Gettext.domain('gnome-shell-frippery').gettext;

    let bottomPanel = new BottomPanel(meta.path);
    bottomPanel.relayout();

    global.screen.override_workspace_layout(Meta.ScreenCorner.TOPLEFT, false, 1, -1);

    MessageTray.MessageTray.prototype._showTray = function() {
        let primary = Main.layoutManager.primaryMonitor;
        let h = bottomPanel._overviewVisible ? 0 : bottomPanel.actor.get_theme_node().get_height();
        this._tween(this.actor, '_trayState', MessageTray.State.SHOWN,
                    { y: - this.actor.height - h,
                      time: MessageTray.ANIMATION_TIME,
                      transition: 'easeOutQuad'
                    });
    };

    global.screen.override_workspace_layout(Meta.ScreenCorner.TOPLEFT, false, 1, -1);


    WindowManager.WindowManager.prototype._showWorkspaceSwitcher =
    function(shellwm, binding, window, backwards) {
        if (global.screen.n_workspaces == 1)
            return;

        if (this._workspaceSwitcherPopup == null)
            this._workspaceSwitcherPopup = new DummyWorkspaceSwitcherPopup();

        if (binding == 'switch_to_workspace_left')
            this.actionMoveWorkspaceLeft();
        else if (binding == 'switch_to_workspace_right')
            this.actionMoveWorkspaceRight();
        // up/down would effectively act as synonyms for left/right if we enabled them;
        // but that could be considered confusing.
        // else if (binding == 'switch_to_workspace_up')
        //     this.actionMoveWorkspaceUp();
        // else if (binding == 'switch_to_workspace_down')
        //     this.actionMoveWorkspaceDown();
    };

    WindowManager.WindowManager.prototype._resetKeyBindings = function() {
        this.setKeybindingHandler('switch_to_workspace_left', Lang.bind(this, this._showWorkspaceSwitcher));
        this.setKeybindingHandler('switch_to_workspace_right', Lang.bind(this, this._showWorkspaceSwitcher));
        this.setKeybindingHandler('switch_to_workspace_up', Lang.bind(this, this._showWorkspaceSwitcher));
        this.setKeybindingHandler('switch_to_workspace_down', Lang.bind(this, this._showWorkspaceSwitcher));
    };

    Main.wm._resetKeyBindings();
}


function init(meta) {
    main(meta);
}

function enable() {
}

function disable() {
}
