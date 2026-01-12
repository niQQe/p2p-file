import { FileTransfer } from "@/components/file-transfer";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-background">
      <div className="z-10 w-full max-w-5xl items-center justify-center font-mono text-sm flex flex-col gap-8">
        <FileTransfer />
      </div>
    </main>
  );
}
