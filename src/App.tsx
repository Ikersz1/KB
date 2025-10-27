import { useAppStore } from "./lib/store";
import { Navigation } from "./components/Navigation";
import { IngestionScreen } from "./components/IngestionScreen";
import { QuestionsScreen } from "./components/QuestionsScreen";
import { ConfigScreen } from "./components/ConfigScreen";
import { ExecutionScreen } from "./components/ExecutionScreen";
import { AuditScreen } from "./components/AuditScreen";
import { Toaster } from "./components/ui/sonner";

export default function App() {
  const { currentScreen } = useAppStore();

  const renderCurrentScreen = () => {
    switch (currentScreen) {
      case 'ingestion':
        return <IngestionScreen />;
      case 'questions':
        return <QuestionsScreen />;
      case 'config':
        return <ConfigScreen />;
      case 'execution':
        return <ExecutionScreen />;
      case 'audit':
        return <AuditScreen />;
      default:
        return <IngestionScreen />;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <main className="flex-1">
        {renderCurrentScreen()}
      </main>
      <Toaster />
    </div>
  );
}