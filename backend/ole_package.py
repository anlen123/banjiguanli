"""Write a non-linked OLE Package using MS-CFB / MS-OLEDS structures.

No payload is executed. Stream names/CLSID are standard Packager identifiers.
Small streams are padded to the 4096-byte cutoff to avoid a MiniFAT; the native
stream records its exact payload length. DIFAT handles files larger than ~7 MB.
"""

import math
import struct
import uuid

FREE = 0xFFFFFFFF
END = 0xFFFFFFFE
FAT = 0xFFFFFFFD
DIFAT = 0xFFFFFFFC
CLSID = uuid.UUID("0003000c-0000-0000-c000-000000000046").bytes_le


def package_file(filename: str, payload: bytes) -> bytes:
    # Use a portable ASCII name internally; the workbook retains the full name.
    name = filename.encode("ascii") + b"\x00"
    native = struct.pack("<H", 2) + name + name
    native += struct.pack("<II", 0x00030000, len(name)) + name
    native += struct.pack("<I", len(payload)) + payload
    native = struct.pack("<I", len(native)) + native
    compobj = bytes.fromhex("0100feff030a0000ffffffff") + CLSID
    compobj += (struct.pack("<I", 8) + b"Package\x00") * 3
    compobj += bytes.fromhex("f439b271000000000000000000000000")
    streams = [
        ("\x01Ole", bytes.fromhex("0100000200000000000000000000000000000000")),
        ("\x01CompObj", compobj),
        ("\x01Ole10Native", native),
    ]
    streams = [(n, data.ljust(max(4096, len(data)), b"\x00")) for n, data in streams]
    data_sectors = 1 + sum(math.ceil(len(data) / 512) for _, data in streams)
    fats, difats = 1, 0
    while True:
        next_fats = math.ceil((data_sectors + fats + difats) / 128)
        next_difats = max(0, math.ceil((next_fats - 109) / 127))
        if (next_fats, next_difats) == (fats, difats):
            break
        fats, difats = next_fats, next_difats
    fat_ids = list(range(data_sectors, data_sectors + fats))
    difat_ids = list(range(data_sectors + fats, data_sectors + fats + difats))
    table = [FREE] * (fats * 128)
    table[0] = END
    for sid in fat_ids:
        table[sid] = FAT
    for sid in difat_ids:
        table[sid] = DIFAT

    def directory(name, kind, left=FREE, right=FREE, child=FREE, start=END, size=0):
        encoded = (name + "\x00").encode("utf-16le")
        return (
            encoded.ljust(64, b"\x00")
            + struct.pack("<HBBIII", len(encoded), kind, 1, left, right, child)
            + (CLSID if kind == 5 else b"\x00" * 16)
            + b"\x00" * 20
            + struct.pack("<IQ", start, size)
        )

    entries = [directory("Root Entry", 5, child=2)]
    sectors = []
    sid = 1
    for index, (name, data) in enumerate(streams, 1):
        count = math.ceil(len(data) / 512)
        entries.append(
            directory(
                name,
                2,
                left=1 if index == 2 else FREE,
                right=3 if index == 2 else FREE,
                start=sid,
                size=len(data),
            )
        )
        for pos in range(sid, sid + count):
            table[pos] = pos + 1 if pos < sid + count - 1 else END
        sectors.append(data.ljust(count * 512, b"\x00"))
        sid += count
    header = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 16
    header += struct.pack("<HHHHH", 0x3E, 3, 0xFFFE, 9, 6) + b"\x00" * 6
    header += struct.pack(
        "<IIIIIIIII", 0, fats, 0, 0, 4096, END, 0, difat_ids[0] if difat_ids else END, difats
    )
    header += struct.pack("<109I", *(fat_ids[:109] + [FREE] * max(0, 109 - fats)))
    extra_difat = bytearray()
    for i, _ in enumerate(difat_ids):
        ids = fat_ids[109 + i * 127 : 109 + (i + 1) * 127]
        extra_difat += struct.pack("<127I", *(ids + [FREE] * (127 - len(ids))))
        extra_difat += struct.pack("<I", difat_ids[i + 1] if i + 1 < difats else END)
    return (
        header
        + b"".join(entries)
        + b"".join(sectors)
        + struct.pack(f"<{len(table)}I", *table)
        + extra_difat
    )
