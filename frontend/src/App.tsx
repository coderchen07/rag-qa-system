import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import RAG from "./pages/RAG";
import Search from "./pages/Search";
import Chat from "./pages/Chat";
import Login from "./pages/Login";
import ProtectedRoute from "./components/ProtectedRoute";
import { useAuthStore } from "./store/auth";
import Header from "./components/Header";

type ProtectedPageProps = {
  children: JSX.Element;
};

function ProtectedPage({ children }: ProtectedPageProps): JSX.Element {
  return (
    <ProtectedRoute>
      <>
        <Header />
        {children}
      </>
    </ProtectedRoute>
  );
}

function App(): JSX.Element {
  const restoreAuth = useAuthStore((state) => state.restoreAuth);

  useEffect(() => {
    restoreAuth();
  }, [restoreAuth]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedPage>
              <RAG />
            </ProtectedPage>
          }
        />
        <Route
          path="/rag"
          element={
            <ProtectedPage>
              <RAG />
            </ProtectedPage>
          }
        />
        <Route
          path="/search"
          element={
            <ProtectedPage>
              <Search />
            </ProtectedPage>
          }
        />
        <Route
          path="/chat"
          element={
            <ProtectedPage>
              <Chat />
            </ProtectedPage>
          }
        />
        <Route path="*" element={<Navigate to="/rag" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
