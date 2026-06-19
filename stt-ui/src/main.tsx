import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import WidgetView from "./components/WidgetView";
import "./styles/globals.css";

const isWidget = new URLSearchParams(window.location.search).get("window") === "widget";

if (isWidget) {
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  document.getElementById("root")!.style.background = "transparent";
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isWidget ? <WidgetView /> : <App />}
  </React.StrictMode>,
);
