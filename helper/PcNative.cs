// Bridge Night Helper: Windows functions shared by the PC features (all read-only, no admin rights).

using System;
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

        public const float Gb = 1024f * 1024f * 1024f;
        public const float Mb = 1024f * 1024f;
    }
}
