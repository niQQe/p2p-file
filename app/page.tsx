import { FileTransfer } from "@/components/file-transfer";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-background">
      <div className="z-10 w-full max-w-5xl items-center justify-center font-mono text-sm flex flex-col gap-8">
        <h1 className="text-4xl font-bold tracking-tight mb-8 bg-gradient-to-r from-primary to-primary/50 bg-clip-text text-transparent">
          P2P File Transfer
        </h1>
        <FileTransfer />
      </div>
    </main>
  );
}
