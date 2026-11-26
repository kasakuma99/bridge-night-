// Bridge Night Helper: graphics card temperature from the AMD driver (atiadlxx.dll, the AMD Display Library).
// Read-only sensor query, the same one AMD's own overlay uses; no admin rights. Best effort: on any failure
// (no AMD card, old driver, missing function) it gives null and never tries again.

using System;
using System.Runtime.InteropServices;

namespace BridgeNight
{
    static class AmdTemp
    {
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        delegate IntPtr AdlAlloc(int size);

        [StructLayout(LayoutKind.Sequential)]
        struct AdlTemperature { public int Size; public int Temperature; }

        [DllImport("atiadlxx.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int ADL2_Main_Control_Create(AdlAlloc alloc, int enumConnectedAdapters, out IntPtr context);
        [DllImport("atiadlxx.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int ADL2_Adapter_NumberOfAdapters_Get(IntPtr context, out int count);
        [DllImport("atiadlxx.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int ADL2_Adapter_Active_Get(IntPtr context, int adapter, out int active);
        [DllImport("atiadlxx.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int ADL2_New_QueryPMLogData_Get(IntPtr context, int adapter, IntPtr output);
        [DllImport("atiadlxx.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int ADL2_OverdriveN_Temperature_Get(IntPtr context, int adapter, int type, out int milliDegrees);
        [DllImport("atiadlxx.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int ADL2_Overdrive5_Temperature_Get(IntPtr context, int adapter, int thermal, ref AdlTemperature t);

        static readonly AdlAlloc alloc = Alloc; // kept in a field so the driver can always call it
        static IntPtr Alloc(int size) { return Marshal.AllocCoTaskMem(size); }

        const int PmLogMaxSensors = 256, PmLogTemperatureEdge = 8; // ADL_PMLOG_MAX_SENSORS, PMLOG_TEMPERATURE_EDGE

        static readonly object gate = new object();
        static bool dead;
        static IntPtr context = IntPtr.Zero;
        static int count, adapter = -1, method = -1;

        /// Degrees Celsius of the first AMD graphics card that answers, or null.
        public static float? Read()
        {
            lock (gate)
            {
                if (dead) return null;
                try
                {
                    if (context == IntPtr.Zero)
                    {
                        if (ADL2_Main_Control_Create(alloc, 1, out context) != 0 || context == IntPtr.Zero
                            || ADL2_Adapter_NumberOfAdapters_Get(context, out count) != 0 || count <= 0)
                            return Give("no AMD graphics driver answered");
                    }
                    if (method >= 0) return ReadWith(method, adapter);
                    for (int a = 0; a < count; a++)
                    {
                        int active;
                        if (ADL2_Adapter_Active_Get(context, a, out active) != 0 || active == 0) continue;
                        for (int m = 0; m < 3; m++)
                        {
                            float? v = Try(m, a);
                            if (v.HasValue) { adapter = a; method = m; return v; }
                        }
                    }
                    return Give("the AMD driver has no temperature sensor to read");
                }
                catch (Exception e) { return Give(e.GetType().Name); } // DllNotFound, EntryPointNotFound, ...
            }
        }

        static float? Try(int m, int a) { try { return ReadWith(m, a); } catch (EntryPointNotFoundException) { return null; } }

        static float? ReadWith(int m, int a)
        {
            float v = 0;
            if (m == 0) // Overdrive 8 (RX 5000 and newer)
            {
                int size = 4 + PmLogMaxSensors * 8;
                var buf = Marshal.AllocHGlobal(size);
                try
                {
                    for (int i = 0; i < size; i += 4) Marshal.WriteInt32(buf, i, 0);
                    Marshal.WriteInt32(buf, 0, size);
                    if (ADL2_New_QueryPMLogData_Get(context, a, buf) != 0) return null;
                    int off = 4 + PmLogTemperatureEdge * 8;
                    if (Marshal.ReadInt32(buf, off) == 0) return null; // not supported
                    v = Marshal.ReadInt32(buf, off + 4);
                }
                finally { Marshal.FreeHGlobal(buf); }
            }
            else if (m == 1) // Overdrive N (Vega, RX 400/500)
            {
                int milli;
                if (ADL2_OverdriveN_Temperature_Get(context, a, 1, out milli) != 0) return null;
                v = milli / 1000f;
            }
            else // Overdrive 5 (older cards)
            {
                var t = new AdlTemperature { Size = Marshal.SizeOf(typeof(AdlTemperature)) };
                if (ADL2_Overdrive5_Temperature_Get(context, a, 0, ref t) != 0) return null;
                v = t.Temperature / 1000f;
            }
            return v > 0 && v < 150 ? (float?)v : null;
        }

        static float? Give(string why)
        {
            dead = true;
            PcServices.Log("GPU temperature not available: " + why);
            return null;
        }
    }
}
