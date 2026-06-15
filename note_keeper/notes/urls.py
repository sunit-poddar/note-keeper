from django.urls import path
from notes import views

urlpatterns = [
    path('', views.editor, name='editor'),
    path('api/notes/', views.api_note_list, name='api_note_list'),
    path('api/notes/create/', views.api_note_create, name='api_note_create'),
    path('api/notes/<int:note_id>/', views.api_note_detail, name='api_note_detail'),
    path('api/notes/<int:note_id>/save/', views.api_note_save, name='api_note_save'),
    path('api/notes/<int:note_id>/delete/', views.api_note_delete, name='api_note_delete'),
    path('api/notes/<int:note_id>/publish/', views.api_note_publish, name='api_note_publish'),
    path('note/<slug:note_slug>/', views.public_note, name='public_note'),
]
