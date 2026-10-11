// tweakRegistry — declarative table of the 24 phase-1 tweaks.
// Each entry: { key, type: 'b'|'i', default (stock GNOME value),
//   apply(api, value, settings), revert(api) }.
// apply() handles only the non-stock branch; revert() forces stock state and
// must be idempotent (disable() reverts every entry unconditionally).
// Tweak logic adapted from just-perfection by JustPerfection (GPL-3.0).

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as OSDWindow from 'resource:///org/gnome/shell/ui/osdWindow.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as SearchController from 'resource:///org/gnome/shell/ui/searchController.js';
import * as WindowPreview from 'resource:///org/gnome/shell/ui/windowPreview.js';
import * as WorkspaceSwitcherPopup from 'resource:///org/gnome/shell/ui/workspaceSwitcherPopup.js';

// 3x3 grid shared by tweaks-notification-banner-position / tweaks-osd-position
const XY = {TOP_START: 0, TOP_CENTER: 1, TOP_END: 2,
            BOTTOM_START: 3, BOTTOM_CENTER: 4, BOTTOM_END: 5,
            CENTER_START: 6, CENTER_CENTER: 7, CENTER_END: 8};

function xyAlign(pos) {
    const A = Clutter.ActorAlign;
    switch (pos) {
        case XY.TOP_START:    return [A.START, A.START];
        case XY.TOP_CENTER:   return [A.CENTER, A.START];
        case XY.TOP_END:      return [A.END, A.START];
        case XY.BOTTOM_START: return [A.START, A.END];
        case XY.BOTTOM_CENTER:return [A.CENTER, A.END];
        case XY.BOTTOM_END:   return [A.END, A.END];
        case XY.CENTER_START: return [A.START, A.CENTER];
        case XY.CENTER_CENTER:return [A.CENTER, A.CENTER];
        case XY.CENTER_END:   return [A.END, A.CENTER];
        default: return null;
    }
}

// ---------- tweaks-panel (hide whole panel) ----------
let panelHideWorkareasId = 0;
let panelHideHeightId = 0;

function panelHideApply(api) {
    const lm = Main.layoutManager;
    const panelBox = lm?.panelBox;
    if (!panelBox)
        return;
    if (panelBox.get_parent() === lm.uiGroup) {
        lm.removeChrome(panelBox);
        lm.overviewGroup.insert_child_at_index(panelBox, 0);
    }
    // top panel slides up, bottom panel slides down
    panelBox.translation_y = panelBox.height * (panelBox.y > 1 ? 1 : -1);
    // hide+show fixes windows going under the panel
    panelBox.hide();
    panelBox.show();
    if (!panelHideWorkareasId)
        panelHideWorkareasId = api.connectSignal(global.display, 'workareas-changed',
            () => panelHideApply(api));
    if (!panelHideHeightId)
        panelHideHeightId = api.connectSignal(panelBox, 'notify::height',
            () => panelHideApply(api));
    lm._updateHotCorners?.();
}

function panelHideRevert(api) {
    const lm = Main.layoutManager;
    const panelBox = lm?.panelBox;
    if (panelHideWorkareasId) {
        api.disconnectSignal(global.display, panelHideWorkareasId);
        panelHideWorkareasId = 0;
    }
    if (panelHideHeightId && panelBox) {
        api.disconnectSignal(panelBox, panelHideHeightId);
        panelHideHeightId = 0;
    }
    if (!panelBox)
        return;
    panelBox.translation_y = 0;
    if (panelBox.get_parent() === lm.overviewGroup) {
        lm.overviewGroup.remove_child(panelBox);
        lm.addChrome(panelBox, {affectsStruts: true, trackFullscreen: true});
    }
    panelBox.hide();
    panelBox.show();
    lm._updateHotCorners?.();
}

// ---------- tweaks-top-panel-position ----------
let panelPosWorkareasId = 0;
let panelPosHeightId = 0;

function fixPanelMenuSide(api, position) {
    const proto = PanelMenu.Button?.prototype;
    if (!proto)
        return;
    if (position === St.Side.TOP) {
        api.restorePatched('panelmenu-setmenu');
        return;
    }
    // fix already-open menus
    const boxes = [Main.panel._centerBox, Main.panel._rightBox, Main.panel._leftBox];
    const fix = widget => {
        if (widget instanceof PanelMenu.Button && widget.menu?._boxPointer)
            widget.menu._boxPointer._userArrowSide = position;
        widget.get_children().forEach(fix);
    };
    boxes.forEach(box => box && fix(box));
    // fix menus opened later
    api.patchOnce('panelmenu-setmenu', proto, 'setMenu', orig => function (menu) {
        orig.call(this, menu);
        if (menu?._boxPointer)
            menu._boxPointer._userArrowSide = position;
    });
}

function panelSetBottom(api) {
    const lm = Main.layoutManager;
    const panelBox = lm?.panelBox;
    const monitor = lm?.primaryMonitor;
    if (!panelBox || !monitor)
        return;
    panelBox.set_position(monitor.x,
        monitor.y + monitor.height - (Main.panel?.height ?? 0));
    api.addUiGroupClass('lfn-bottom-panel');
    fixPanelMenuSide(api, St.Side.BOTTOM);
    if (!panelPosWorkareasId)
        panelPosWorkareasId = api.connectSignal(global.display, 'workareas-changed',
            () => panelSetBottom(api));
    if (!panelPosHeightId)
        panelPosHeightId = api.connectSignal(panelBox, 'notify::height',
            () => panelSetBottom(api));
}

function panelSetTop(api) {
    const lm = Main.layoutManager;
    const panelBox = lm?.panelBox;
    if (panelPosWorkareasId) {
        api.disconnectSignal(global.display, panelPosWorkareasId);
        panelPosWorkareasId = 0;
    }
    if (panelPosHeightId && panelBox) {
        api.disconnectSignal(panelBox, panelPosHeightId);
        panelPosHeightId = 0;
    }
    const monitor = lm?.primaryMonitor;
    if (panelBox && monitor)
        panelBox.set_position(monitor.x, monitor.y);
    api.removeUiGroupClass('lfn-bottom-panel');
    fixPanelMenuSide(api, St.Side.TOP);
}

// ---------- tweaks-clock-menu-position (+ offset) ----------
let clockMenuPosSignalIds = [];

function clockMenuDisconnect(api) {
    const boxes = [Main.panel._centerBox, Main.panel._rightBox, Main.panel._leftBox];
    clockMenuPosSignalIds.forEach((id, i) => {
        if (id && boxes[i])
            api.disconnectSignal(boxes[i], id);
    });
    clockMenuPosSignalIds = [];
}

function clockMenuMove(api, pos, offset, armSignals = true) {
    const panel = Main.panel;
    const dateMenu = panel?.statusArea?.dateMenu;
    if (!dateMenu?.container)
        return;
    const boxes = [panel._centerBox, panel._rightBox, panel._leftBox];
    if (boxes.some(b => !b))
        return;
    clockMenuDisconnect(api);
    let fromPos = -1, fromIndex = -1;
    for (let i = 0; i <= 2; i++) {
        const idx = boxes[i].get_children().indexOf(dateMenu.container);
        if (idx !== -1) { fromPos = i; fromIndex = idx; break; }
    }
    if (fromPos === -1)
        return;
    const toIndex = Math.max(0, Math.min(offset, boxes[pos].get_children().length));
    if (!(pos === fromPos && toIndex === fromIndex)) {
        boxes[fromPos].remove_child(dateMenu.container);
        boxes[pos].insert_child_at_index(dateMenu.container, toIndex);
    }
    if (Main.sessionMode.isLocked)
        api.hideActor(dateMenu.container);
    if (armSignals)
        clockMenuPosSignalIds = boxes.map((box, i) =>
            api.connectSignal(box, 'child-added', () => clockMenuMove(api, pos, offset)));
}

// ---------- panel status-area buttons (entries 1-5) ----------
function statusAreaEntry(key, area, lockGuard = false) {
    return {
        key, type: 'b', default: true,
        apply(api) {
            api.hideActor(Main.panel.statusArea[area]?.container);
        },
        revert(api) {
            const item = Main.panel.statusArea[area];
            if (item && !(lockGuard && Main.sessionMode.isLocked))
                item.container.show();
        },
    };
}

// ---------- tweaks-window-maximized-on-create ----------
let windowCreatedId = 0;

// ---------- tweaks-window-demands-attention-focus ----------
let attentionSignalIds = [];

// ---------- tweaks-startup-status ----------
let startupCompleteId = 0;

// ---------- tweaks-animation ----------
// index = value - 2 (values 2-8); matches upstream just-perfection
const ANIMATION_FACTORS = [0.01, 0.2, 0.6, 0.8, 1.3, 1.6, 2.8];

export const TWEAK_REGISTRY = [
    // 1-5. panel status-area buttons (hide per key, show on revert)
    statusAreaEntry('tweaks-activities-button', 'activities', true),
    statusAreaEntry('tweaks-clock-menu', 'dateMenu', true),
    statusAreaEntry('tweaks-keyboard-layout', 'keyboard'),
    statusAreaEntry('tweaks-accessibility-menu', 'a11y'),
    statusAreaEntry('tweaks-quick-settings', 'quickSettings'),
    // 6. whole panel
    {
        key: 'tweaks-panel', type: 'b', default: true,
        apply: panelHideApply,
        revert: panelHideRevert,
    },
    // 7. panel top/bottom
    {
        key: 'tweaks-top-panel-position', type: 'i', default: 0,
        apply(api, value) {
            if (value === 1)
                panelSetBottom(api);
            else
                panelSetTop(api);
        },
        revert: panelSetTop,
    },
    // 8. panel size (0 = auto)
    {
        key: 'tweaks-panel-size', type: 'i', default: 0,
        apply(api, size) {
            if (size > 100 || size < 0 || !Main.panel)
                return;
            api.saveValue('panelHeight', Main.panel.height);
            Main.panel.height = size;
        },
        revert(api) {
            if (api.hasSaved('panelHeight') && Main.panel) {
                Main.panel.height = api.getSaved('panelHeight');
                api.forgetSaved('panelHeight');
            }
        },
    },
    // 9. clock menu position (0=center, 1=right, 2=left)
    {
        key: 'tweaks-clock-menu-position', type: 'i', default: 0,
        apply(api, pos, settings) {
            clockMenuMove(api, pos, settings.getInt('tweaks-clock-menu-position-offset'));
        },
        revert(api) {
            clockMenuMove(api, 0, 0, false);
            clockMenuDisconnect(api);
        },
    },
    // 10. clock menu offset — reuses the position mover
    {
        key: 'tweaks-clock-menu-position-offset', type: 'i', default: 0,
        apply(api, offset, settings) {
            clockMenuMove(api, settings.getInt('tweaks-clock-menu-position'), offset);
        },
        revert() { /* covered by entry 9's revert */ },
    },
    // 11. overview search entry
    {
        key: 'tweaks-search', type: 'b', default: true,
        apply(api) {
            api.addUiGroupClass('lfn-no-search');
            api.hideActor(Main.overview?.searchEntry);
        },
        revert(api) {
            api.removeUiGroupClass('lfn-no-search');
            api.showActor(Main.overview?.searchEntry);
        },
    },
    // 12. type-to-search
    {
        key: 'tweaks-type-to-search', type: 'b', default: true,
        apply(api) {
            const proto = SearchController.SearchController?.prototype;
            if (!proto)
                return;
            api.patchOnce('start-search', proto, 'startSearch', () => () => {});
        },
        revert(api) {
            api.restorePatched('start-search');
        },
    },
    // 13. animation speed (0=off, 1=default, 2..8 steps)
    {
        key: 'tweaks-animation', type: 'i', default: 1,
        apply(api, value) {
            if (value === 0) {
                api.restoreSlowDownFactor();
                api.saveValue('enableAnimations', api.getSystemBoolean('enable-animations'));
                api.setSystemBoolean('enable-animations', false);
            } else if (value === 1) {
                api.restoreSlowDownFactor();
                api.saveValue('enableAnimations', api.getSystemBoolean('enable-animations'));
                api.setSystemBoolean('enable-animations', true);
            } else if (ANIMATION_FACTORS[value - 2] !== undefined) {
                api.setSlowDownFactor(ANIMATION_FACTORS[value - 2]);
            }
        },
        revert(api) {
            api.restoreSlowDownFactor();
            if (api.hasSaved('enableAnimations')) {
                api.setSystemBoolean('enable-animations', api.getSaved('enableAnimations'));
                api.forgetSaved('enableAnimations');
            }
        },
    },
    // 14. maximize windows on creation
    {
        key: 'tweaks-window-maximized-on-create', type: 'b', default: false,
        apply(api) {
            if (windowCreatedId)
                return;
            windowCreatedId = api.connectSignal(global.display, 'window-created',
                (display, win) => {
                    if (win?.can_maximize())
                        win.maximize(); // GNOME >= 49: no flags needed
                });
        },
        revert(api) {
            if (windowCreatedId) {
                api.disconnectSignal(global.display, windowCreatedId);
                windowCreatedId = 0;
            }
        },
    },
    // 15. focus window on demands-attention instead of just marking urgent
    {
        key: 'tweaks-window-demands-attention-focus', type: 'b', default: false,
        apply(api) {
            if (attentionSignalIds.length)
                return;
            const focusIt = (display, win) => {
                if (!win || win.has_focus() || win.is_skip_taskbar())
                    return;
                Main.activateWindow(win);
            };
            api.blockSignal(global.display, 'window-demands-attention');
            api.blockSignal(global.display, 'window-marked-urgent');
            attentionSignalIds = [
                api.connectSignal(global.display, 'window-demands-attention', focusIt),
                api.connectSignal(global.display, 'window-marked-urgent', focusIt),
            ];
        },
        revert(api) {
            for (const id of attentionSignalIds)
                api.disconnectSignal(global.display, id);
            attentionSignalIds = [];
            api.unblockSignal(global.display, 'window-demands-attention');
            api.unblockSignal(global.display, 'window-marked-urgent');
        },
    },
    // 16. workspace wrap-around
    {
        key: 'tweaks-workspace-wrap-around', type: 'b', default: false,
        apply(api) {
            const proto = Meta.Workspace?.prototype;
            if (!proto)
                return;
            api.patchOnce('ws-get-neighbor', proto, 'get_neighbor', () => function (dir) {
                const index = this.index();
                const lastIndex = global.workspace_manager.n_workspaces - 1;
                const neighborIndex =
                    (dir === Meta.MotionDirection.UP || dir === Meta.MotionDirection.LEFT)
                        ? (index > 0 ? index - 1 : lastIndex)
                        : (index < lastIndex ? index + 1 : 0);
                return global.workspace_manager.get_workspace_by_index(neighborIndex);
            });
        },
        revert(api) {
            api.restorePatched('ws-get-neighbor');
        },
    },
    // 17. workspace switcher popup
    {
        key: 'tweaks-workspace-popup', type: 'b', default: true,
        apply(api) {
            const proto = WorkspaceSwitcherPopup.WorkspaceSwitcherPopup?.prototype;
            if (!proto)
                return;
            api.patchOnce('ws-popup-display', proto, 'display', () => function () {
                this.destroy();
            });
        },
        revert(api) {
            api.restorePatched('ws-popup-display');
        },
    },
    // 18. startup status (0=desktop, 1=overview)
    {
        key: 'tweaks-startup-status', type: 'i', default: 1,
        apply(api, value) {
            if (value !== 0 || startupCompleteId)
                return;
            const lm = Main.layoutManager;
            if (!lm._startingUp)
                return;
            api.saveValue('sessionModeHasOverview', Main.sessionMode.hasOverview);
            Main.sessionMode.hasOverview = false;
            lm.startInOverview = false;
            startupCompleteId = api.connectSignal(lm, 'startup-complete', () => {
                Main.sessionMode.hasOverview = api.getSaved('sessionModeHasOverview');
                api.forgetSaved('sessionModeHasOverview');
                api.disconnectSignal(lm, startupCompleteId);
                startupCompleteId = 0;
            });
        },
        revert(api) {
            const lm = Main.layoutManager;
            if (startupCompleteId) {
                api.disconnectSignal(lm, startupCompleteId);
                startupCompleteId = 0;
            }
            if (api.hasSaved('sessionModeHasOverview')) {
                Main.sessionMode.hasOverview = api.getSaved('sessionModeHasOverview');
                api.forgetSaved('sessionModeHasOverview');
            }
        },
    },
    // 19. notification banner position (3x3 grid)
    {
        key: 'tweaks-notification-banner-position', type: 'i', default: 1,
        apply(api, pos) {
            const aligns = xyAlign(pos);
            const tray = Main.messageTray;
            const bannerBin = tray?._bannerBin;
            if (!aligns || !tray || !bannerBin)
                return;
            api.saveValue('bannerAlignment', tray.bannerAlignment);
            api.saveValue('bannerYAlign', bannerBin.get_y_align());
            api.saveValue('hideNotification', tray._hideNotification);
            tray.bannerAlignment = aligns[0];
            if (aligns[1] === Clutter.ActorAlign.END) {
                // bottom area: override _hideNotification with an animation
                // that doesn't glitch (EASE instead of EASE_OUT_BACK)
                const {State, ANIMATION_TIME} = MessageTray;
                tray._hideNotification = function (animate) {
                    this._notificationFocusGrabber.ungrabFocus();
                    this._banner.disconnectObject(this);
                    this._resetNotificationLeftTimeout();
                    this._bannerBin.remove_all_transitions();
                    if (animate) {
                        this._notificationState = State.HIDING;
                        this._bannerBin.ease({
                            opacity: 0, duration: ANIMATION_TIME,
                            mode: Clutter.AnimationMode.EASE,
                        });
                        this._bannerBin.ease({
                            opacity: 0, y: this._bannerBin.height,
                            duration: ANIMATION_TIME, mode: Clutter.AnimationMode.EASE,
                            onComplete: () => {
                                this._notificationState = State.HIDDEN;
                                this._hideNotificationCompleted();
                                this._updateState();
                            },
                        });
                    } else {
                        this._bannerBin.y = this._bannerBin.height;
                        this._bannerBin.opacity = 0;
                        this._notificationState = State.HIDDEN;
                        this._hideNotificationCompleted();
                    }
                };
            }
            bannerBin.set_y_align(aligns[1]);
        },
        revert(api) {
            const tray = Main.messageTray;
            const bannerBin = tray?._bannerBin;
            if (api.hasSaved('bannerAlignment') && tray)
                tray.bannerAlignment = api.getSaved('bannerAlignment');
            if (api.hasSaved('bannerYAlign') && bannerBin)
                bannerBin.set_y_align(api.getSaved('bannerYAlign'));
            if (api.hasSaved('hideNotification') && tray)
                tray._hideNotification = api.getSaved('hideNotification');
            api.forgetSaved('bannerAlignment');
            api.forgetSaved('bannerYAlign');
            api.forgetSaved('hideNotification');
        },
    },
    // 20. OSD
    {
        key: 'tweaks-osd', type: 'b', default: true,
        apply(api) {
            const mgr = Main.osdWindowManager;
            if (!mgr)
                return;
            api.patchOnce('osd-show', mgr, 'show', () => () => {});
            // showOne/showAll exist on GNOME >= 49
            if (typeof mgr.showOne === 'function')
                api.patchOnce('osd-show-one', mgr, 'showOne', () => () => {});
            if (typeof mgr.showAll === 'function')
                api.patchOnce('osd-show-all', mgr, 'showAll', () => () => {});
        },
        revert(api) {
            api.restorePatched('osd-show');
            api.restorePatched('osd-show-one');
            api.restorePatched('osd-show-all');
        },
    },
    // 21. OSD position (3x3 grid)
    {
        key: 'tweaks-osd-position', type: 'i', default: 0,
        apply(api, pos) {
            const aligns = xyAlign(pos);
            const proto = OSDWindow.OsdWindow?.prototype;
            if (!aligns || !proto)
                return;
            const windows = Main.osdWindowManager?._osdWindows ?? [];
            if (windows.length > 0) {
                api.saveValue('osdXAlign', windows[0].x_align);
                api.saveValue('osdYAlign', windows[0].y_align);
            }
            api.patchOnce('osdwin-show', proto, 'show', orig => function () {
                this.x_align = aligns[0];
                this.y_align = aligns[1];
                orig.call(this);
            });
            for (const w of windows) {
                w.x_align = aligns[0];
                w.y_align = aligns[1];
            }
        },
        revert(api) {
            api.restorePatched('osdwin-show');
            if (api.hasSaved('osdXAlign') && api.hasSaved('osdYAlign')) {
                const windows = Main.osdWindowManager?._osdWindows ?? [];
                for (const w of windows) {
                    w.x_align = api.getSaved('osdXAlign');
                    w.y_align = api.getSaved('osdYAlign');
                }
                api.forgetSaved('osdXAlign');
                api.forgetSaved('osdYAlign');
            }
        },
    },
    // 22. overlay key (Super)
    {
        key: 'tweaks-overlay-key', type: 'b', default: true,
        apply(api) {
            api.blockSignal(global.display, 'overlay-key');
        },
        revert(api) {
            api.unblockSignal(global.display, 'overlay-key');
        },
    },
    // 23. ripple box animation
    {
        key: 'tweaks-ripple-box', type: 'b', default: true,
        apply(api) {
            api.addUiGroupClass('lfn-no-ripple-box');
        },
        revert(api) {
            api.removeUiGroupClass('lfn-no-ripple-box');
        },
    },
    // 24. window preview caption
    {
        key: 'tweaks-window-preview-caption', type: 'b', default: true,
        apply(api) {
            const proto = WindowPreview.WindowPreview?.prototype;
            if (!proto)
                return;
            api.patchOnce('winpreview-caption', proto, '_getCaption', () => () => '');
            api.addUiGroupClass('lfn-no-window-caption');
        },
        revert(api) {
            api.restorePatched('winpreview-caption');
            api.removeUiGroupClass('lfn-no-window-caption');
        },
    },
];
