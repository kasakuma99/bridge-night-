import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "@fontsource/outfit/500.css";
import "@fontsource/outfit/600.css";
import "@fontsource/outfit/700.css";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "./index.css";
import { AuthProvider, DataProvider, DDragonProvider, PrefsProvider } from "./data/context";
import { ConfirmProvider, ToastProvider } from "./components/ui";
import { Layout } from "./components/Layout";
import { FEATURES } from "./lib/features";
import Teams from "./pages/Teams";
import TeamsClassic from "./pages/TeamsClassic";
import Live from "./pages/Live";
import History from "./pages/History";
import Stats from "./pages/Stats";
import Rivals from "./pages/Rivals";
import Builds from "./pages/Builds";
import Players from "./pages/Players";
import Helper from "./pages/Helper";
import NotFound from "./pages/NotFound";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <DataProvider>
          <DDragonProvider>
            <PrefsProvider>
              <ToastProvider>
                <ConfirmProvider>
                  <Routes>
                    <Route element={<Layout />}>
                      <Route index element={FEATURES.classicTeams ? <TeamsClassic /> : <Teams />} />
                      <Route path="live" element={<Live />} />
                      <Route path="history" element={<History />} />
                      <Route path="stats" element={<Stats />} />
                      {FEATURES.rivals && <Route path="rivals" element={<Rivals />} />}
                      {FEATURES.builds && <Route path="builds" element={<Builds />} />}
                      <Route path="players" element={<Players />} />
                      <Route path="helper" element={<Helper />} />
                      <Route path="*" element={<NotFound />} />
                    </Route>
                  </Routes>
                </ConfirmProvider>
              </ToastProvider>
            </PrefsProvider>
          </DDragonProvider>
        </DataProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
