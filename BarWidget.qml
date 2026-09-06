import QtQuick
import qs.Commons
import qs.Ui
import "Icons.js" as Icons

// A hammer in the bar. Left click opens the weapon menu; middle click puts
// the desktop back together without going through the menu.
BarWidget {
  id: root
  moduleName: "io.github.crsmthw.omageddon"

  readonly property var host: bar ? bar.shell : null

  function launch() {
    if (host && typeof host.toggle === "function") host.toggle(moduleName, "{}")
    else if (bar && typeof bar.run === "function")
      bar.run("omarchy-shell shell toggle " + moduleName)
  }

  // The overlay owns the damage, so repairs have to be asked of it. The shell
  // keeps the instance loaded, so this works whether or not the game is up.
  function repair() {
    if (host && typeof host.invokeIfLoaded === "function")
      host.invokeIfLoaded(moduleName, "repairAll", "")
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    labelVisible: false
    hasVisualContent: true
    tooltipText: "Desktop Destroyer"
    fixedWidth: root.vertical ? -1 : Math.round(art.implicitWidth + scaledHorizontalMargin * 2)
    fixedHeight: root.vertical ? Math.round(art.implicitHeight + scaledVerticalPadding * 2) : -1

    onPressed: function (buttonCode) {
      if (buttonCode === Qt.MiddleButton) root.repair()
      else root.launch()
    }

    Canvas {
      id: art
      anchors.centerIn: parent
      implicitWidth: Style.bar.iconCanvas
      implicitHeight: Style.bar.iconCanvas
      width: implicitWidth
      height: implicitHeight
      onPaint: {
        var ctx = getContext("2d")
        ctx.clearRect(0, 0, width, height)
        Icons.drawIcon(ctx, "hammer", 0, 0, width)
      }
      Component.onCompleted: requestPaint()
    }
  }
}
