// Bridge Night Helper: Windows functions shared by the PC features (all read-only, no admin rights).

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace BridgeNight
{
    static class PcNative
    {
        [StructLayout(LayoutKind.Sequential)]
        public struct MemoryStatusEx
        {
            public uint Length, MemoryLoad;
            public ulong TotalPhys, AvailPhys, TotalPageFile, AvailPageFile, TotalVirtual, AvailVirtual, AvailExtendedVirtual;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct PerformanceInformation
        {
            public uint Size;
            public UIntPtr CommitTotal, CommitLimit, CommitPeak, PhysicalTotal, PhysicalAvailable, SystemCache,
                KernelTotal, KernelPaged, KernelNonpaged, PageSize;
            public uint HandleCount, ProcessCount, ThreadCount;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool GlobalMemoryStatusEx(ref MemoryStatusEx status);

        [DllImport("psapi.dll", SetLastError = true)]
        public static extern bool GetPerformanceInfo(out PerformanceInformation info, uint size);

        [DllImport("kernel32.dll")]
        public static extern ulong GetTickCount64();

        /// SystemProcessorPerformanceInformation (8): idle/kernel/user time per logical processor.
        [DllImport("ntdll.dll")]
        public static extern int NtQuerySystemInformation(int infoClass, IntPtr buffer, int length, out int returned);

        delegate bool EnumWindowsProc(IntPtr window, IntPtr param);
        [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr param);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
        [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window, uint cmd);
        [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr window);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);

        /// Process.MainWindowHandle / MainWindowTitle for every process in one pass (that property walks all windows
        /// once per process): process id -> its main window (the first visible one without an owner) has a title.
        public static Dictionary<int, bool> MainWindows()
        {
            var found = new Dictionary<int, bool>();
            EnumWindows(delegate(IntPtr w, IntPtr p)
            {
                if (!IsWindowVisible(w) || GetWindow(w, 4 /* GW_OWNER */) != IntPtr.Zero) return true;
                uint pid;
                GetWindowThreadProcessId(w, out pid);
                if (!found.ContainsKey((int)pid)) found[(int)pid] = GetWindowTextLength(w) > 0;
                return true;
            }, IntPtr.Zero);
            return found;
        }

        public const float Gb = 1024f * 1024f * 1024f;
        public const float Mb = 1024f * 1024f;
    }
}
