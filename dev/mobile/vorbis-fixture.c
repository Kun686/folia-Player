#include <vorbis/vorbisenc.h>
#include <ogg/ogg.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>

/* vorbis-fixture.c — encode generated stereo test tones with the already approved Xiph libraries. */
static void write_page(FILE *out, ogg_page *page) {
    if (fwrite(page->header, 1, page->header_len, out) != (size_t)page->header_len ||
        fwrite(page->body, 1, page->body_len, out) != (size_t)page->body_len) exit(2);
}
int main(int argc, char **argv) {
    if (argc != 2) return 2;
    FILE *out = fopen(argv[1], "wb"); if (!out) return 2;
    vorbis_info info; vorbis_info_init(&info);
    if (vorbis_encode_init_vbr(&info, 2, 44100, 0.4)) return 2;
    vorbis_comment tags; vorbis_comment_init(&tags);
    vorbis_comment_add_tag(&tags, "TITLE", "Generated Vorbis");
    vorbis_comment_add_tag(&tags, "ARTIST", "Left 440 Hz");
    vorbis_comment_add_tag(&tags, "ARTIST", "Right 660 Hz");
    vorbis_comment_add_tag(&tags, "ALBUM", "Folia offline QA");
    vorbis_comment_add_tag(&tags, "TRACKNUMBER", "2/8");
    vorbis_comment_add_tag(&tags, "DISCNUMBER", "3/4");
    vorbis_comment_add_tag(&tags, "LYRICS", "[00:00.00]Generated lyric\n[00:04.00]Second line");
    vorbis_comment_add_tag(&tags, "REPLAYGAIN_TRACK_GAIN", "-3 dB");
    vorbis_dsp_state dsp; vorbis_block block; ogg_stream_state stream; ogg_page page;
    if (vorbis_analysis_init(&dsp, &info) || vorbis_block_init(&dsp, &block) || ogg_stream_init(&stream, 686)) return 2;
    ogg_packet header, comment, code;
    if (vorbis_analysis_headerout(&dsp, &tags, &header, &comment, &code)) return 2;
    ogg_stream_packetin(&stream, &header); ogg_stream_packetin(&stream, &comment); ogg_stream_packetin(&stream, &code);
    while (ogg_stream_flush(&stream, &page)) write_page(out, &page);
    for (int at = 0; at <= 44100 * 8; at += 1024) {
        int count = 44100 * 8 - at; if (count > 1024) count = 1024; if (count < 0) count = 0;
        float **pcm = vorbis_analysis_buffer(&dsp, count);
        for (int i = 0; i < count; i++) {
            double t = (at + i) / 44100.0;
            pcm[0][i] = 0.15 * sin(2 * M_PI * 440 * t);
            pcm[1][i] = 0.10 * sin(2 * M_PI * 660 * t);
        }
        vorbis_analysis_wrote(&dsp, count);
        while (vorbis_analysis_blockout(&dsp, &block) == 1) {
            vorbis_analysis(&block, NULL); vorbis_bitrate_addblock(&block);
            ogg_packet packet;
            while (vorbis_bitrate_flushpacket(&dsp, &packet)) {
                ogg_stream_packetin(&stream, &packet);
                while (ogg_stream_pageout(&stream, &page)) write_page(out, &page);
            }
        }
        if (count == 0) break;
        if (at + count == 44100 * 8) at = 44100 * 8 - 1024;
    }
    ogg_stream_clear(&stream); vorbis_block_clear(&block); vorbis_dsp_clear(&dsp);
    vorbis_comment_clear(&tags); vorbis_info_clear(&info);
    return fclose(out) == 0 ? 0 : 2;
}
