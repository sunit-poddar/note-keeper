from django.db import models
from slugify import slugify
from django.contrib.auth.models import User


class TimestampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Note(TimestampedModel):
    author = models.ForeignKey(to=User, on_delete=models.CASCADE, related_name="notes", db_index=False)
    title = models.CharField(max_length=256, blank=True, default='Untitled')
    text = models.TextField(blank=True, default='')
    is_public = models.BooleanField(default=False)
    slug = models.SlugField(unique=True, null=True, blank=True, default=None)

    class Meta:
        verbose_name_plural = "Notes"
        indexes = [
            models.Index(fields=['author', '-updated_at'], name='notes_author_updated_idx'),
        ]

    def publish(self):
        self.slug = slugify(self.title)
        self.is_public = True
        self.save()
        return self.slug


class UploadedImage(models.Model):
    author = models.ForeignKey(User, on_delete=models.CASCADE, related_name='images')
    image = models.ImageField(upload_to='images/%Y/%m/')
    uploaded_at = models.DateTimeField(auto_now_add=True)
