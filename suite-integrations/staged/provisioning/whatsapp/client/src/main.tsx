import SuiteEntry from './SuiteEntry';
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(location.pathname==='/suite-entry'?<SuiteEntry/>:<App />);
