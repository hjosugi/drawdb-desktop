import ReactDOM from "react-dom/client";
import { LocaleProvider } from "@douyinfe/semi-ui";
import App from "./App.jsx";
import FilePathProvider from "./context/FilePathContext.jsx";
import { installDesktopExternalLinkHandler } from "./desktop/externalLinks.js";
import en_US from "@douyinfe/semi-ui/lib/es/locale/source/en_US";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "bootstrap-icons/font/bootstrap-icons.css";
import "./index.css";
import "./i18n/i18n.js";

installDesktopExternalLinkHandler();

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <LocaleProvider locale={en_US}>
    <FilePathProvider>
      <App />
    </FilePathProvider>
  </LocaleProvider>,
);
