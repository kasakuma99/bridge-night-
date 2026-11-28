import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
// Headings: VT323 (the UI kit). Text is Tahoma / Verdana from the system.
import "@fontsource/vt323/400.css";
import "./index.css";
import { AuthProvider, DataProvider, DDragonProvider, PrefsProvider } from "./data/context";
import { ConfirmProvider, ToastProvider } from "./components/ui";
import { Layout } from "./components/Layout";
import { FEATURES } from "./lib/features";
import Teams from "./pages/Teams";
import TeamsClassic from "./pages/TeamsClassic";
import Live from "./pages/Live";
import LiveClassic from "./pages/LiveClassic";
import History from "./pages/History";
import Stats from "./pages/Stats";
import PlayerStats from "./pages/PlayerStats";
import Rivals from "./pages/Rivals";
import Builds from "./pages/Builds";
import Players from "./pages/Players";
import Helper from "./pages/Helper";
import NotFound from "./pages/NotFound";

// The Arcade loads only when someone opens it, so the rest of the site stays small.
const Arcade = lazy(() => import("./pages/Arcade"));

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
                      <Route path="live" element={FEATURES.classicTeams ? <LiveClassic /> : <Live />} />
                      <Route path="history" element={<History />} />
                      <Route path="stats" element={<Stats />} />
                      {FEATURES.playerPages && <Route path="stats/:id" element={<PlayerStats />} />}
                      {FEATURES.rivals && <Route path="rivals" element={<Rivals />} />}
                      {FEATURES.builds && <Route path="builds" element={<Builds />} />}
                      <Route path="players" element={<Players />} />
                      <Route path="helper" element={<Helper />} />
                      {FEATURES.arcade && (
                        <Route
                          path="arcade/:game?"
                          element={
                            <Suspense fallback={null}>
                              <Arcade />
                            </Suspense>
                          }
                        />
                      )}
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
